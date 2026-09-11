<#
  小红书可见内容采集器（本机 Edge / Chrome DevTools Protocol）

  使用方式：
    1. 先用 start-xhs-edge.ps1 启动一个带调试端口的 Edge，并在该窗口登录小红书。
    2. 运行：
       powershell -ExecutionPolicy Bypass -File .\xhs-cdp-collector.ps1 -Query '沙面 停车','沙面岛 停车场'

  说明：
    - 只读取浏览器中实际可见的文字和链接，不读取接口、不绕过登录/验证码/风控。
    - 结果先保存为待审核 JSON，后续确认字段后再导入 parking.db。
#>
[CmdletBinding()]
param(
  [string[]]$Query = @('沙面 停车'),
  [int]$DebugPort = 9222,
  [int]$WaitSeconds = 5,
  [int]$PageReadyTimeoutSeconds = 40,
  [int]$OpenNotes = 3,
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $PSScriptRoot 'xhs-captures.json'
}

function Receive-WebSocketMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [int]$TimeoutMilliseconds = 15000
  )

  $buffer = New-Object byte[] 16384
  $stream = New-Object System.IO.MemoryStream
  $cancel = New-Object System.Threading.CancellationTokenSource
  $cancel.CancelAfter($TimeoutMilliseconds)
  try {
    do {
      $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
      $received = $Socket.ReceiveAsync($segment, $cancel.Token).GetAwaiter().GetResult()
      if ($received.Count -gt 0) {
        $stream.Write($buffer, 0, $received.Count)
      }
    } while (-not $received.EndOfMessage)
  } finally {
    $cancel.Dispose()
  }

  [Text.Encoding]::UTF8.GetString($stream.ToArray())
}

function Send-CdpCommand {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [int]$Id,
    [string]$Method,
    [hashtable]$Params = @{}
  )

  $payload = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
  $Socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

  while ($true) {
    $message = Receive-WebSocketMessage -Socket $Socket | ConvertFrom-Json
    if ($message.id -eq $Id) {
      if ($null -ne $message.error) {
        throw "CDP command failed: $Method - $($message.error.message)"
      }
      return $message
    }
  }
}

function Invoke-Javascript {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$CommandId,
    [string]$Expression
  )

  $CommandId.Value++
  $response = Send-CdpCommand -Socket $Socket -Id $CommandId.Value -Method 'Runtime.evaluate' -Params @{
    expression = $Expression
    awaitPromise = $true
    returnByValue = $true
    userGesture = $true
  }
  $result = $response.result.result
  if ($result.subtype -eq 'error') {
    throw "Page script failed: $($result.description)"
  }
  $result.value
}

function Wait-PageCondition {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$CommandId,
    [string]$Expression,
    [int]$TimeoutSeconds = 40
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      if ([bool](Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $Expression)) {
        return $true
      }
    } catch {
      # 页面切换期间 Runtime.evaluate 可能短暂失败，继续等待下一次轮询。
    }
    Start-Sleep -Milliseconds 1000
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Click-PageText {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$CommandId,
    [string]$Text
  )

  $safeText = $Text.Replace('\\', '\\\\').Replace("'", "\\'")
  $script = @'
(() => {
  const wanted = '__TEXT__';
  const visible = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,span,div'))
    .filter(el => visible(el) && (el.innerText || '').trim() === wanted);
  const node = nodes.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
  if (!node) return false;
  node.click();
  return true;
})()
'@
  $script = $script.Replace('__TEXT__', $safeText)
  Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $script
}

function Get-PageTarget {
  param([int]$Port)

  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
  } catch {
    throw "Cannot connect to browser debug port $Port. Run server\\start-xhs-edge.ps1 first, then sign in in the new browser window."
  }

  $target = @($targets | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl } | Select-Object -First 1)
  if (-not $target) {
    throw "The debug port is reachable, but no usable page target was found. Open Xiaohongshu in the debug browser."
  }
  $target
}

function Get-VisiblePageSnapshot {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$CommandId
  )

  $script = @'
(() => {
  const clean = (value, max = 6000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map(a => {
      const card = a.closest('section, article, li, div');
      return {
        text: clean(a.innerText || a.textContent, 300),
        href: a.href,
        cardText: clean(card && (card.innerText || card.textContent), 1200)
      };
    })
    .filter(x => x.href && (x.text || x.cardText));
  const unique = [];
  const seen = new Set();
  for (const item of links) {
    const key = item.href + '\n' + item.cardText;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return {
    url: location.href,
    title: document.title,
    text: clean(document.body && document.body.innerText, 50000),
    links: unique.slice(0, 300)
  };
})()
'@
  Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $script
}

$target = Get-PageTarget -Port $DebugPort
$socket = New-Object System.Net.WebSockets.ClientWebSocket
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$commandId = 0
$captures = @()
$filterLabel = [string]::Concat([char]0x7b5b, [char]0x9009) # 筛选
$mostCollectedLabel = [string]::Concat([char]0x6700, [char]0x591a, [char]0x6536, [char]0x85cf) # 最多收藏
$sortUnavailableLabel = [string]::Concat([char]0x672a, [char]0x80fd, [char]0x5e94, [char]0x7528, [char]0x6700, [char]0x591a, [char]0x6536, [char]0x85cf, [char]0x7b5b, [char]0x9009) # 未能应用最多收藏筛选

try {
  foreach ($keyword in $Query) {
    if ([string]::IsNullOrWhiteSpace($keyword)) { continue }

    $encoded = [Uri]::EscapeDataString($keyword)
    $url = "https://www.xiaohongshu.com/search_result?keyword=$encoded&type=51"
    $commandId++
    [void](Send-CdpCommand -Socket $socket -Id $commandId -Method 'Page.navigate' -Params @{ url = $url })
    Start-Sleep -Seconds $WaitSeconds

    $searchReadyExpression = @'
(() => {
  const text = (document.body && document.body.innerText) || '';
  const cards = Array.from(document.querySelectorAll('a[href*="/search_result/"]'))
    .filter(a => (a.innerText || a.textContent || '').trim() || (a.closest('section,article,li,div')?.innerText || '').trim()).length;
  return document.readyState === 'complete' && text.includes('筛选') && cards > 0;
})()
'@
    if (-not (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $searchReadyExpression -TimeoutSeconds $PageReadyTimeoutSeconds)) {
      Write-Warning ("[$keyword] 搜索结果页面在规定时间内未完成，跳过本次，避免继续操作未加载页面。")
      continue
    }

    $sortApplied = $false
    if (Click-PageText -Socket $socket -CommandId ([ref]$commandId) -Text $filterLabel) {
      Start-Sleep -Milliseconds 1000
      $sortMenuExpression = @'
(() => Array.from(document.querySelectorAll('button,[role="button"],a,span,div'))
  .some(el => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && (el.innerText || '').trim() === '最多收藏';
  }))()
'@
      if (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $sortMenuExpression -TimeoutSeconds 10) {
        $sortApplied = [bool](Click-PageText -Socket $socket -CommandId ([ref]$commandId) -Text $mostCollectedLabel)
      }
      Start-Sleep -Seconds $WaitSeconds
    }
    $sortMode = $sortUnavailableLabel
    if ($sortApplied) { $sortMode = $mostCollectedLabel }

    $noteLinksExpression = @'
(() => Array.from(document.querySelectorAll('a[href*="/search_result/"]')).length > 0)()
'@
    if (-not (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $noteLinksExpression -TimeoutSeconds $PageReadyTimeoutSeconds)) {
      Write-Warning ("[$keyword] 排序后的笔记卡片未完成加载，跳过本次，避免读取不完整结果。")
      continue
    }

    $snapshot = Get-VisiblePageSnapshot -Socket $socket -CommandId ([ref]$commandId)
    $blockedText = [string]$snapshot.text
    $blockedSignals = @(
      'captcha', 'login', 'restricted', 'too frequent', 'failed to load', 'security check',
      ([string]::Concat([char]0x767b, [char]0x5f55, [char]0x540e, [char]0x67e5, [char]0x770b)), # 登录后查看
      ([string]::Concat([char]0x9a8c, [char]0x8bc1, [char]0x7801)), # 验证码
      ([string]::Concat([char]0x8bbf, [char]0x95ee, [char]0x53d7, [char]0x9650)), # 访问受限
      ([string]::Concat([char]0x64cd, [char]0x4f5c, [char]0x9891, [char]0x7e41)), # 操作频繁
      ([string]::Concat([char]0x52a0, [char]0x8f7d, [char]0x5931, [char]0x8d25)), # 加载失败
      ([string]::Concat([char]0x5b89, [char]0x5168, [char]0x9a8c, [char]0x8bc1)), # 安全验证
      ([string]::Concat([char]0x5f53, [char]0x524d, [char]0x7b14, [char]0x8bb0, [char]0x6682, [char]0x65f6, [char]0x65e0, [char]0x6cd5, [char]0x6d4f, [char]0x89c8)), # 当前笔记暂时无法浏览
      ([string]::Concat([char]0x4f60, [char]0x8bbf, [char]0x95ee, [char]0x7684, [char]0x9875, [char]0x9762, [char]0x4e0d, [char]0x89c1, [char]0x4e86)) # 你访问的页面不见了
    )
    $blocked = @($blockedSignals | Where-Object { $blockedText.Contains($_) }).Count -gt 0

    $notes = @()
    $noteLinks = @()
    $seenNoteCards = @{}
    foreach ($candidate in @($snapshot.links)) {
      # 搜索结果页的 search_result 链接带有 xsec_token，优先于裸 explore 链接。
      if ($candidate.href -notmatch '/search_result/[0-9a-z]+' -or -not $candidate.cardText) { continue }
      $cardKey = [string]$candidate.cardText
      if (-not $seenNoteCards.ContainsKey($cardKey)) {
        $seenNoteCards[$cardKey] = $true
        $noteLinks += $candidate
      }
      if ($noteLinks.Count -ge [Math]::Max(0, $OpenNotes)) { break }
    }

    foreach ($noteLink in $noteLinks) {
      $commandId++
      [void](Send-CdpCommand -Socket $socket -Id $commandId -Method 'Page.navigate' -Params @{ url = $noteLink.href })
      Start-Sleep -Seconds $WaitSeconds
      $noteReadyExpression = @'
(() => {
  const text = (document.body && document.body.innerText) || '';
  return document.readyState === 'complete' && text.length > 500 && text.includes('关注');
})()
'@
      if (-not (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $noteReadyExpression -TimeoutSeconds $PageReadyTimeoutSeconds)) {
        Write-Warning ("笔记页面未完成加载，跳过当前笔记，继续下一条。")
        continue
      }
      $noteSnapshot = Get-VisiblePageSnapshot -Socket $socket -CommandId ([ref]$commandId)
      $noteText = [string]$noteSnapshot.text
      $noteBlocked = @($blockedSignals | Where-Object { $noteText.Contains($_) }).Count -gt 0

      $notes += [ordered]@{
        source_card = $noteLink.cardText
        note_url = $noteSnapshot.url
        title = $noteSnapshot.title
        blocked_or_incomplete = $noteBlocked
        visible_text = $noteText
        visible_links = $noteSnapshot.links
      }
      $noteStatus = 'captured'
      if ($noteBlocked) { $noteStatus = 'manual check required' }
      Write-Host ("  note {0} | visible text {1} chars | status {2}" -f $noteSnapshot.url, $noteText.Length, $noteStatus)
      if ($noteBlocked) { break }
      Start-Sleep -Seconds $WaitSeconds
    }

    $captures += [ordered]@{
      keyword = $keyword
      captured_at = (Get-Date).ToUniversalTime().ToString('o')
      url = $snapshot.url
      title = $snapshot.title
      sort_mode = $sortMode
      blocked_or_incomplete = $blocked
      visible_text = $snapshot.text
      visible_links = $snapshot.links
      notes = $notes
    }

    $pageStatus = 'captured'
    if ($blocked) { $pageStatus = 'manual check required' }
    Write-Host ("[{0}] {1} | visible links {2} | status {3}" -f $keyword, $snapshot.title, @($snapshot.links).Count, $pageStatus)
    if ($blocked) {
      Write-Warning 'The page shows a login/captcha/restriction/load failure signal. Collection stopped.'
      break
    }
  }
} finally {
  $socket.Dispose()
}

$json = $captures | ConvertTo-Json -Depth 20
Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8
Write-Host "Capture saved to: $OutputPath"
