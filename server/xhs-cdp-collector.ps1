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
  [string]$OutputPath = (Join-Path $PSScriptRoot 'xhs-captures.json')
)

$ErrorActionPreference = 'Stop'

function Receive-WebSocketMessage {
  param([System.Net.WebSockets.ClientWebSocket]$Socket)

  $buffer = New-Object byte[] 16384
  $stream = New-Object System.IO.MemoryStream
  do {
    $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
    $received = $Socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($received.Count -gt 0) {
      $stream.Write($buffer, 0, $received.Count)
    }
  } while (-not $received.EndOfMessage)

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

try {
  foreach ($keyword in $Query) {
    if ([string]::IsNullOrWhiteSpace($keyword)) { continue }

    $encoded = [Uri]::EscapeDataString($keyword)
    $url = "https://www.xiaohongshu.com/search_result?keyword=$encoded&type=51"
    $commandId++
    [void](Send-CdpCommand -Socket $socket -Id $commandId -Method 'Page.navigate' -Params @{ url = $url })
    Start-Sleep -Seconds $WaitSeconds

    $snapshot = Get-VisiblePageSnapshot -Socket $socket -CommandId ([ref]$commandId)
    $blockedText = [string]$snapshot.text
    $blockedSignals = @(
      'captcha', 'login', 'restricted', 'too frequent', 'failed to load', 'security check',
      ([string]::Concat([char]0x767b, [char]0x5f55, [char]0x540e, [char]0x67e5, [char]0x770b)), # 登录后查看
      ([string]::Concat([char]0x9a8c, [char]0x8bc1, [char]0x7801)), # 验证码
      ([string]::Concat([char]0x8bbf, [char]0x95ee, [char]0x53d7, [char]0x9650)), # 访问受限
      ([string]::Concat([char]0x64cd, [char]0x4f5c, [char]0x9891, [char]0x7e41)), # 操作频繁
      ([string]::Concat([char]0x52a0, [char]0x8f7d, [char]0x5931, [char]0x8d25)), # 加载失败
      ([string]::Concat([char]0x5b89, [char]0x5168, [char]0x9a8c, [char]0x8bc1))  # 安全验证
    )
    $blocked = @($blockedSignals | Where-Object { $blockedText.Contains($_) }).Count -gt 0

    $captures += [ordered]@{
      keyword = $keyword
      captured_at = (Get-Date).ToUniversalTime().ToString('o')
      url = $snapshot.url
      title = $snapshot.title
      blocked_or_incomplete = $blocked
      visible_text = $snapshot.text
      visible_links = $snapshot.links
    }

    Write-Host ("[{0}] {1} | visible links {2} | status {3}" -f $keyword, $snapshot.title, @($snapshot.links).Count, $(if ($blocked) { 'manual check required' } else { 'captured' }))
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
