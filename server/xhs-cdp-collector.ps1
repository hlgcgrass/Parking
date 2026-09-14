<#
  小红书可见内容采集器（本机 Edge / Chrome DevTools Protocol）

  使用方式：
    1. 先用 start-xhs-edge.ps1 启动一个带调试端口的 Edge，并在该窗口登录小红书。
    2. 运行：
       pwsh -NoProfile -ExecutionPolicy Bypass -File .\xhs-cdp-collector.ps1 -Query '沙面 停车','沙面岛 停车场'

  说明：
    - 只读取浏览器中实际可见的文字和链接，不读取接口、不绕过登录/验证码/风控。
    - 搜索页和每条笔记详情页都会先保存为本地原始 JSON，后续整理阶段只读取这些文件。
    - 不保存图片、视频、Cookie 或账号信息；结果确认字段后再导入 parking.db。
#>
[CmdletBinding()]
param(
  [string[]]$Query = @('沙面 停车'),
  [int]$DebugPort = 9222,
  [int]$WaitSeconds = 5,
  [int]$BetweenNotesSeconds = 5,
  [int]$BetweenPlacesSeconds = 10,
  [int]$PageReadyTimeoutSeconds = 40,
  [int]$OpenNotes = 3,
  [string]$OutputPath = '',
  [string]$RawOutputDir = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $PSScriptRoot 'xhs-captures.json'
}
if ([string]::IsNullOrWhiteSpace($RawOutputDir)) {
  $RawOutputDir = Join-Path $PSScriptRoot 'xhs-raw'
}
New-Item -ItemType Directory -Path $RawOutputDir -Force | Out-Null

function Get-SafeFilePart {
  param([string]$Value)
  $safe = [string]$Value -replace '[\\/:*?"<>|\r\n]+', '_'
  $safe = $safe.Trim(' ', '.')
  if ([string]::IsNullOrWhiteSpace($safe)) { return 'unknown' }
  return $safe.Substring(0, [Math]::Min(80, $safe.Length))
}

function Get-NoteIdFromUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return '' }
  $match = [regex]::Match($Url, '/(?:search_result|explore|note)/([0-9a-f]+)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($match.Success) { return $match.Groups[1].Value }
  return ''
}

function Get-TargetPlaceFromKeyword {
  param([string]$Keyword)
  $place = $Keyword -replace '\s*(停车攻略|停车场|停车收费|自驾停车|停车)\s*$', ''
  return $place.Trim()
}

function Get-CardRelevance {
  param(
    [string]$TargetPlace,
    [string]$CardText,
    [hashtable]$PlaceAliases,
    [string[]]$KnownPlaces
  )

  $text = [string]$CardText
  $aliases = @($TargetPlace)
  if ($PlaceAliases.ContainsKey($TargetPlace)) {
    $aliases += @($PlaceAliases[$TargetPlace])
  }
  $aliases = @($aliases | Select-Object -Unique)
  $locationMatches = @($aliases | Where-Object { $text.Contains([string]$_) })
  $parkingTerms = @('停车', '车位', '车库', '地库', '自驾', '驾车', '收费', '入口')
  $strongParkingTerms = @('停车攻略', '停车场', '停车费', '停车收费', '停车位', '停车指南', '车位', '车库', '地库')
  $negativeTerms = @('游玩', '游览', '门票', '拍照', '亲子', '遛娃', '一日游', '打卡', '美食', '夜景', '景点介绍')
  $parkingMatches = @($parkingTerms | Where-Object { $text.Contains($_) } | Select-Object -Unique)
  $strongParkingMatches = @($strongParkingTerms | Where-Object { $text.Contains($_) } | Select-Object -Unique)
  $negativeMatches = @($negativeTerms | Where-Object { $text.Contains($_) } | Select-Object -Unique)
  $otherLocationMatches = @($KnownPlaces | Where-Object {
      $_ -and $_.Length -ge 3 -and -not ($aliases -contains $_) -and $text.Contains($_)
    } | Select-Object -Unique)

  $score = 0
  if ($locationMatches.Count -gt 0) { $score += 10 }
  if ($strongParkingMatches.Count -gt 0) { $score += 8 }
  elseif ($parkingMatches.Count -gt 0) { $score += 4 }
  if ($negativeMatches.Count -gt 0) { $score -= [Math]::Min(6, $negativeMatches.Count * 2) }
  if ($locationMatches.Count -eq 0 -and $otherLocationMatches.Count -gt 0) { $score -= 10 }

  $accepted = $locationMatches.Count -gt 0 -and $parkingMatches.Count -gt 0
  $skipReason = ''
  if (-not $accepted) {
    if ($locationMatches.Count -eq 0 -and $otherLocationMatches.Count -gt 0) {
      $skipReason = '地点不匹配：出现其他地点 ' + ($otherLocationMatches -join '、')
    } elseif ($locationMatches.Count -eq 0) {
      $skipReason = '未明确提到目标地点'
    } else {
      $skipReason = '停车相关性不足'
    }
  }

  [ordered]@{
    relevance_score = $score
    accepted = $accepted
    location_match = $locationMatches.Count -gt 0
    location_matches = $locationMatches
    other_location_matches = $otherLocationMatches
    parking_signal = $parkingMatches.Count -gt 0
    parking_matches = $parkingMatches
    negative_matches = $negativeMatches
    skip_reason = $skipReason
  }
}

function Save-RawJson {
  param(
    [string]$Path,
    [object]$Value
  )
  $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding UTF8
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

function Click-NoteTypeOption {
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
  const inNoteTypeSection = el => {
    let parent = el;
    for (let i = 0; i < 20 && parent; i++, parent = parent.parentElement) {
      const text = (parent.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.includes('笔记类型') && text.includes('图文') && text.includes('视频')) return true;
    }
    return false;
  };
  const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,span,div'))
    .filter(el => visible(el) && (el.innerText || '').trim() === wanted && inNoteTypeSection(el));
  const node = nodes.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
  if (!node) return false;
  node.click();
  return true;
})()
'@
  $script = $script.Replace('__TEXT__', $safeText)
  Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $script
}

function Test-NoteTypeOptionVisible {
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
  return Array.from(document.querySelectorAll('button,[role="button"],a,span,div')).some(el => {
    if (!visible(el) || (el.innerText || '').trim() !== wanted) return false;
    let parent = el;
    for (let i = 0; i < 20 && parent; i++, parent = parent.parentElement) {
      const text = (parent.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.includes('笔记类型') && text.includes('图文') && text.includes('视频')) return true;
    }
    return false;
  });
})()
'@
  $script = $script.Replace('__TEXT__', $safeText)
  [bool](Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $script)
}

function Get-PageTarget {
  param([int]$Port)

  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
  } catch {
    throw "Cannot connect to browser debug port $Port. Run server\\start-xhs-edge.ps1 first, then sign in in the new browser window."
  }

  $pageTargets = @($targets | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl })
  $target = @($pageTargets | Where-Object { $_.url -match 'xiaohongshu\.com' } | Select-Object -First 1)
  if (-not $target) {
    $target = @($pageTargets | Select-Object -First 1)
  }
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

function Click-NoteLink {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$CommandId,
    [string]$Href
  )

  $safeHref = $Href.Replace('\\', '\\\\').Replace("'", "\\'")
  $script = @"
(() => {
  const wanted = '$safeHref';
  const noteId = (wanted.match(/\/search_result\/([0-9a-z]+)/i) || [])[1] || '';
  const link = Array.from(document.querySelectorAll('a[href*="/search_result/"]'))
    .find(a => a.href === wanted || (noteId && a.href.includes('/search_result/' + noteId)));
  if (!link) return false;
  link.click();
  return true;
})()
"@
  [bool](Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $script)
}

function Close-NoteOverlay {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [ref]$CommandId
  )

  # 详情页是搜索结果上的弹层；按页面左上角的关闭按钮退出，避免用历史返回导致弹层/列表状态不同步。
  $script = @'
(() => {
  const visible = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const label = el => [
    el.getAttribute && el.getAttribute('aria-label'),
    el.getAttribute && el.getAttribute('title'),
    el.getAttribute && el.getAttribute('data-testid'),
    el.className && String(el.className),
    el.innerText || el.textContent
  ].filter(Boolean).join(' ');
  const score = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    let value = 0;
    if (/关闭|close|close-button|close_btn|icon-close|modal-close/i.test(label(el))) value += 100;
    if (s.position === 'fixed' || s.position === 'sticky') value += 20;
    if (r.left < 180 && r.top < 180) value += 15;
    if (r.width <= 110 && r.height <= 110) value += 10;
    value += Math.min(20, Number(s.zIndex) || 0) / 100;
    return value;
  };
  if (!/\/explore\//i.test(location.pathname)) return false;
  const labeled = Array.from(document.querySelectorAll('button,[role="button"],[aria-label],[title],[data-testid],[class*="close"],[class*="Close"]'))
    .filter(visible)
    .filter(el => /关闭|close|close-button|close_btn|icon-close|modal-close|^×$|^✕$/i.test(label(el)))
    .sort((a, b) => score(b) - score(a));
  const fallback = Array.from(document.querySelectorAll('button,[role="button"]'))
    .filter(visible)
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < 180 && r.top < 180 && r.width <= 110 && r.height <= 110;
    })
    .sort((a, b) => score(b) - score(a));
  const target = labeled[0] || fallback[0];
  if (!target) return false;
  target.click();
  return true;
})()
'@
  [bool](Invoke-Javascript -Socket $Socket -CommandId $CommandId -Expression $script)
}

function Wait-BetweenPlaces {
  param([int]$Seconds)
  if ($Seconds -gt 0) {
    Write-Host ("  waiting {0}s before the next place" -f $Seconds)
    Start-Sleep -Seconds $Seconds
  }
}

$target = Get-PageTarget -Port $DebugPort
$socket = New-Object System.Net.WebSockets.ClientWebSocket
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$commandId = 0
$captures = @()
$filterLabel = [string]::Concat([char]0x7b5b, [char]0x9009) # 筛选
$noteTypeLabel = [string]::Concat([char]0x56fe, [char]0x6587) # 图文
$mostLikedLabel = [string]::Concat([char]0x6700, [char]0x591a, [char]0x70b9, [char]0x8d5e) # 最多点赞
$noteTypeUnavailableLabel = [string]::Concat([char]0x672a, [char]0x80fd, [char]0x5e94, [char]0x7528, [char]0x56fe, [char]0x6587, [char]0x7b5b, [char]0x9009) # 未能应用图文筛选
$sortUnavailableLabel = [string]::Concat([char]0x672a, [char]0x80fd, [char]0x5e94, [char]0x7528, [char]0x6700, [char]0x591a, [char]0x70b9, [char]0x8d5e, [char]0x7b5b, [char]0x9009) # 未能应用最多点赞筛选
$placeAliases = @{
  '宝墨园' = @('宝墨园')
  '黄花岗公园' = @('黄花岗公园', '黄花岗七十二烈士墓园')
  '广州烈士陵园' = @('广州烈士陵园')
  '广州博物馆' = @('广州博物馆', '镇海楼')
  '广州美术馆' = @('广州美术馆', '广州艺术博物院', '白鹅潭美术馆')
  '广州大剧院' = @('广州大剧院')
  '星海音乐厅' = @('星海音乐厅')
  '广东科学中心' = @('广东科学中心')
  '广州文化馆' = @('广州文化馆', '广州市文化馆')
  '粤剧艺术博物馆' = @('粤剧艺术博物馆', '粤剧博物馆')
  '十三行博物馆' = @('十三行博物馆', '十三行')
  '黄埔古港' = @('黄埔古港', '古港遗址')
  '太古仓' = @('太古仓', '太古仓码头')
  '东山口' = @('东山口', '新河浦')
  '南沙天后宫' = @('南沙天后宫')
  '南沙湿地公园' = @('南沙湿地公园', '南沙湿地')
  '白水寨' = @('白水寨')
  '流溪河国家森林公园' = @('流溪河国家森林公园', '流溪河森林公园')
  '南方医科大学珠江医院' = @('南方医科大学珠江医院', '珠江医院', '南医大珠江医院')
  '暨南大学附属第一医院' = @('暨南大学附属第一医院', '暨大附一院', '暨大附一', '广州华侨医院')
  '广东省第二人民医院' = @('广东省第二人民医院', '省二医', '省第二人民医院')
  '广州医科大学附属第二医院' = @('广州医科大学附属第二医院', '广医二院', '广医附二院')
  '广州医科大学附属第三医院' = @('广州医科大学附属第三医院', '广医三院', '广医附三院')
  '广州市红十字会医院' = @('广州市红十字会医院', '广州红会医院', '红十字会医院', '红会医院')
  '广州市胸科医院' = @('广州市胸科医院', '广州胸科医院', '胸科医院')
  '广州市第八人民医院' = @('广州市第八人民医院', '广州八院', '广州市八医院')
  '广州市番禺区中心医院' = @('广州市番禺区中心医院', '番禺区中心医院', '番禺中心医院')
  '广州市番禺区何贤纪念医院' = @('广州市番禺区何贤纪念医院', '何贤纪念医院', '何贤医院', '番禺何贤医院', '番禺妇幼')
  '广州市白云区人民医院' = @('广州市白云区人民医院', '白云区人民医院', '白云人民医院')
  '广州市黄埔区人民医院' = @('广州市黄埔区人民医院', '黄埔区人民医院', '黄埔人民医院')
  '广州市花都区人民医院' = @('广州市花都区人民医院', '花都区人民医院', '花都人民医院')
  '广州市南沙区第一人民医院' = @('广州市南沙区第一人民医院', '南沙区第一人民医院', '南沙第一人民医院', '南沙一院')
  '广州市增城区人民医院' = @('广州市增城区人民医院', '增城区人民医院', '增城人民医院')
  '广州市从化区人民医院' = @('广州市从化区人民医院', '从化区人民医院', '从化人民医院')
  '白云机场' = @('白云机场', '广州白云国际机场', '广州白云机场')
  '广州南站' = @('广州南站', '广州南')
  '广州站' = @('广州站', '广州火车站')
  '广州东站' = @('广州东站', '广州东')
  '白云站' = @('白云站', '广州白云站')
  '广州北站' = @('广州北站', '广州北', '花都站', '广州城际花都站')
  '庆盛站' = @('庆盛站', '庆盛')
  '新塘站' = @('新塘站', '新塘')
  '琶洲站' = @('琶洲站', '琶洲')
  '滘口客运站' = @('滘口客运站', '滘口汽车站', '滘口')
  '天河客运站' = @('天河客运站', '天河客运')
  '广州汽车站' = @('广州汽车站')
  '黄埔客运站' = @('黄埔客运站', '黄埔客运')
  '南沙客运港' = @('南沙客运港', '南沙客运')
}
$knownPlaces = @(
  '宝墨园', '黄花岗公园', '广州烈士陵园', '广州博物馆', '广州美术馆', '广州艺术博物院',
  '白鹅潭美术馆', '广州大剧院', '星海音乐厅', '广东科学中心', '广州文化馆', '粤剧艺术博物馆',
  '十三行博物馆', '黄埔古港', '太古仓', '太古仓码头', '东山口', '南沙天后宫', '南沙湿地公园',
  '白水寨', '流溪河国家森林公园', '沙面', '北京路', '永庆坊', '珠江新城', '广州塔',
  '越秀公园', '长隆', '二沙岛', '海心沙', '海珠湖', '莲花山', '陈家祠'
)

try {
  foreach ($keyword in $Query) {
    if ([string]::IsNullOrWhiteSpace($keyword)) { continue }
    $targetPlace = Get-TargetPlaceFromKeyword -Keyword $keyword

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
      Wait-BetweenPlaces -Seconds $BetweenPlacesSeconds
      continue
    }

    $noteTypeApplied = $false
    $sortApplied = $false
    if (Click-PageText -Socket $socket -CommandId ([ref]$commandId) -Text $filterLabel) {
      Start-Sleep -Milliseconds 1000
      if (Test-NoteTypeOptionVisible -Socket $socket -CommandId ([ref]$commandId) -Text $noteTypeLabel) {
        $noteTypeApplied = [bool](Click-NoteTypeOption -Socket $socket -CommandId ([ref]$commandId) -Text $noteTypeLabel)
        # 图文筛选会触发结果刷新；等待页面稳定后再选择排序，避免排序操作落在旧页面状态上。
        Start-Sleep -Seconds 3
      }
      $sortMenuExpression = "(() => Array.from(document.querySelectorAll('button,[role=button],a,span,div')).some(el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && (el.innerText || '').trim() === '最多点赞'; }))()"
      if (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $sortMenuExpression -TimeoutSeconds 10) {
        $sortApplied = [bool](Click-PageText -Socket $socket -CommandId ([ref]$commandId) -Text $mostLikedLabel)
      }
      Start-Sleep -Seconds $WaitSeconds
    }
    $noteTypeMode = $noteTypeUnavailableLabel
    if ($noteTypeApplied) { $noteTypeMode = $noteTypeLabel }
    $sortMode = $sortUnavailableLabel
    if ($sortApplied) { $sortMode = $mostLikedLabel }

    if (-not $noteTypeApplied) {
      Write-Warning ("[$keyword] 图文筛选未生效，保存搜索页状态但不打开结果笔记，避免混入视频内容。")
    }
    if (-not $sortApplied) {
      Write-Warning ("[$keyword] 最多点赞排序未生效，保存搜索页状态但不打开结果笔记。")
    }

    $noteLinksExpression = @'
(() => Array.from(document.querySelectorAll('a[href*="/search_result/"]')).length > 0)()
'@
    if (-not (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $noteLinksExpression -TimeoutSeconds $PageReadyTimeoutSeconds)) {
      Write-Warning ("[$keyword] 排序后的笔记卡片未完成加载，跳过本次，避免读取不完整结果。")
      Wait-BetweenPlaces -Seconds $BetweenPlacesSeconds
      continue
    }

    $snapshot = Get-VisiblePageSnapshot -Socket $socket -CommandId ([ref]$commandId)
    $captureStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
    $queryFilePart = Get-SafeFilePart -Value $keyword
    $searchRawPath = Join-Path $RawOutputDir ("{0}-search-{1}.json" -f $captureStamp, $queryFilePart)
    Save-RawJson -Path $searchRawPath -Value ([ordered]@{
      schema_version = 1
      capture_type = 'xhs_search_page'
      captured_at = (Get-Date).ToUniversalTime().ToString('o')
      keyword = $keyword
      url = $snapshot.url
      title = $snapshot.title
      target_place = $targetPlace
      note_type_mode = $noteTypeMode
      sort_mode = $sortMode
      blocked_or_incomplete = $blocked
      visible_text = $snapshot.text
      visible_links = $snapshot.links
      candidate_analysis = @()
    })
    $blockedText = [string]$snapshot.text
    $blockedSignals = @(
      'captcha', 'login', 'restricted', 'too frequent', 'failed to load', 'security check',
      ([string]::Concat([char]0x767b, [char]0x5f55, [char]0x540e, [char]0x67e5, [char]0x770b)), # 登录后查看
      ([string]::Concat([char]0x9a8c, [char]0x8bc1, [char]0x7801)), # 验证码
      ([string]::Concat([char]0x8bbf, [char]0x95ee, [char]0x53d7, [char]0x9650)), # 访问受限
      ([string]::Concat([char]0x64cd, [char]0x4f5c, [char]0x9891, [char]0x7e41)), # 操作频繁
      ([string]::Concat([char]0x52a0, [char]0x8f7d, [char]0x5931, [char]0x8d25)), # 加载失败
      ([string]::Concat([char]0x5b89, [char]0x5168, [char]0x9a8c, [char]0x8bc1)), # 安全验证
      ([string]::Concat([char]0x5b89, [char]0x5168, [char]0x9650, [char]0x5236)), # 安全限制
      ([string]::Concat([char]0x8bbf, [char]0x95ee, [char]0x94fe, [char]0x63a5, [char]0x5f02, [char]0x5e38)), # 访问链接异常
      '300017', '300031',
      ([string]::Concat([char]0x5f53, [char]0x524d, [char]0x7b14, [char]0x8bb0, [char]0x6682, [char]0x65f6, [char]0x65e0, [char]0x6cd5, [char]0x6d4f, [char]0x89c8)), # 当前笔记暂时无法浏览
      ([string]::Concat([char]0x4f60, [char]0x8bbf, [char]0x95ee, [char]0x7684, [char]0x9875, [char]0x9762, [char]0x4e0d, [char]0x89c1, [char]0x4e86)) # 你访问的页面不见了
    )
    $blocked = @($blockedSignals | Where-Object { $blockedText.Contains($_) }).Count -gt 0
    $stopAfterCurrent = $blocked

    $notes = @()
    $noteLinks = @()
    $seenNoteCards = @{}
    $candidateAnalysis = @()
    $candidateSearchRank = 0
    if ($noteTypeApplied -and $sortApplied) { foreach ($candidate in @($snapshot.links)) {
      # 搜索结果页的 search_result 链接带有 xsec_token，优先于裸 explore 链接。
      if ($candidate.href -notmatch '/search_result/[0-9a-z]+' -or -not $candidate.cardText) { continue }
      $cardKey = [string]$candidate.cardText
      if ($seenNoteCards.ContainsKey($cardKey)) { continue }
      $seenNoteCards[$cardKey] = $true
      $candidateSearchRank++
      $analysis = Get-CardRelevance -TargetPlace $targetPlace -CardText ([string]$candidate.cardText) -PlaceAliases $placeAliases -KnownPlaces $knownPlaces
      $analyzedCandidate = [ordered]@{
        search_rank = $candidateSearchRank
        text = $candidate.text
        href = $candidate.href
        card_text = $candidate.cardText
        relevance_score = $analysis.relevance_score
        accepted = $analysis.accepted
        location_match = $analysis.location_match
        location_matches = $analysis.location_matches
        other_location_matches = $analysis.other_location_matches
        parking_signal = $analysis.parking_signal
        parking_matches = $analysis.parking_matches
        negative_matches = $analysis.negative_matches
        skip_reason = $analysis.skip_reason
      }
      $candidateAnalysis += $analyzedCandidate
      if ($analysis.accepted -and $noteLinks.Count -lt [Math]::Max(0, $OpenNotes)) {
        $noteLinks += [ordered]@{
          text = $candidate.text
          href = $candidate.href
          cardText = $candidate.cardText
          search_rank = $candidateSearchRank
          relevance_score = $analysis.relevance_score
          location_match = $analysis.location_match
          parking_signal = $analysis.parking_signal
        }
      }
    } }
    $searchRaw = Get-Content -Raw -LiteralPath $searchRawPath | ConvertFrom-Json
    $searchRaw.candidate_analysis = $candidateAnalysis
    Save-RawJson -Path $searchRawPath -Value $searchRaw

    $noteRank = 0
    foreach ($noteLink in $noteLinks) {
      $noteRank++
      $clicked = Click-NoteLink -Socket $socket -CommandId ([ref]$commandId) -Href $noteLink.href
      if (-not $clicked) {
        Write-Warning ("[$keyword] 搜索结果卡片无法通过直接点击打开，保存当前状态并跳过。")
        continue
      }
      $noteReadyExpression = @'
(() => {
  const text = (document.body && document.body.innerText) || '';
  const blocked = /安全限制|访问链接异常|安全验证|访问受限|操作频繁|加载失败|验证码|登录后查看|error_code=300017|error_code=300031/.test(text + ' ' + location.href);
  return blocked || (document.readyState === 'complete' && location.pathname.includes('/explore/') && text.length > 500 && text.includes('关注'));
})()
'@
      if (-not (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $noteReadyExpression -TimeoutSeconds $PageReadyTimeoutSeconds)) {
        $incompleteSnapshot = Get-VisiblePageSnapshot -Socket $socket -CommandId ([ref]$commandId)
        $incompletePath = Join-Path $RawOutputDir ("{0}-{1}-note-{2:D2}-{3}.json" -f $captureStamp, $queryFilePart, $noteRank, (Get-NoteIdFromUrl -Url $noteLink.href))
        Save-RawJson -Path $incompletePath -Value ([ordered]@{
          schema_version = 1
          capture_type = 'xhs_note_page'
           captured_at = (Get-Date).ToUniversalTime().ToString('o')
           keyword = $keyword
           rank = $noteRank
           search_rank = $noteLink.search_rank
           note_type_mode = $noteTypeMode
           sort_mode = $sortMode
           relevance_score = $noteLink.relevance_score
           location_match = $noteLink.location_match
           parking_signal = $noteLink.parking_signal
           source_card = $noteLink.cardText
          requested_url = $noteLink.href
          note_url = $incompleteSnapshot.url
          title = $incompleteSnapshot.title
          blocked_or_incomplete = $true
           visible_text = $incompleteSnapshot.text
           visible_links = $incompleteSnapshot.links
         })
         if (@($blockedSignals | Where-Object { ([string]$incompleteSnapshot.text).Contains($_) }).Count -gt 0) {
           $stopAfterCurrent = $true
         }
         Write-Warning ("笔记页面未完成加载，跳过当前笔记，继续下一条。")
        continue
      }
      # 确认详情页已经加载后，再保留一段明确的阅读时间，避免详情层刚出现就被关闭。
      Write-Host ("  detail ready; reading for {0}s before closing" -f $WaitSeconds)
      Start-Sleep -Seconds $WaitSeconds
      $noteSnapshot = Get-VisiblePageSnapshot -Socket $socket -CommandId ([ref]$commandId)
      $noteText = [string]$noteSnapshot.text
      $noteBlocked = @($blockedSignals | Where-Object { $noteText.Contains($_) }).Count -gt 0
      $noteRawPath = Join-Path $RawOutputDir ("{0}-{1}-note-{2:D2}-{3}.json" -f $captureStamp, $queryFilePart, $noteRank, (Get-NoteIdFromUrl -Url $noteLink.href))
      Save-RawJson -Path $noteRawPath -Value ([ordered]@{
        schema_version = 1
        capture_type = 'xhs_note_page'
         captured_at = (Get-Date).ToUniversalTime().ToString('o')
         keyword = $keyword
         rank = $noteRank
         search_rank = $noteLink.search_rank
         note_type_mode = $noteTypeMode
         sort_mode = $sortMode
         relevance_score = $noteLink.relevance_score
         location_match = $noteLink.location_match
         parking_signal = $noteLink.parking_signal
         source_card = $noteLink.cardText
        requested_url = $noteLink.href
        note_url = $noteSnapshot.url
        title = $noteSnapshot.title
        blocked_or_incomplete = $noteBlocked
        visible_text = $noteText
        visible_links = $noteSnapshot.links
      })

       $notes += [ordered]@{
         source_card = $noteLink.cardText
         search_rank = $noteLink.search_rank
         relevance_score = $noteLink.relevance_score
         location_match = $noteLink.location_match
         parking_signal = $noteLink.parking_signal
         note_url = $noteSnapshot.url
        title = $noteSnapshot.title
        blocked_or_incomplete = $noteBlocked
        visible_text = $noteText
        visible_links = $noteSnapshot.links
        raw_file = $noteRawPath
      }
      $noteStatus = 'captured'
      if ($noteBlocked) { $noteStatus = 'manual check required' }
      Write-Host ("  note {0} | visible text {1} chars | status {2}" -f $noteSnapshot.url, $noteText.Length, $noteStatus)
      if ($noteBlocked) {
        $stopAfterCurrent = $true
        break
      }
      if ($noteRank -lt $noteLinks.Count) {
        $closed = Close-NoteOverlay -Socket $socket -CommandId ([ref]$commandId)
        if (-not $closed) {
          Write-Warning ("[$keyword] 未找到详情页左上角关闭按钮，停止当前地点，避免直接跳到下一篇。")
          $stopAfterCurrent = $true
          break
        }
        $closeReadyExpression = @'
(() => {
  const text = (document.body && document.body.innerText) || '';
  const cards = Array.from(document.querySelectorAll('a[href*="/search_result/"]'))
    .filter(a => (a.innerText || a.textContent || '').trim() || (a.closest('section,article,li,div')?.innerText || '').trim()).length;
  return document.readyState === 'complete' && location.pathname.includes('/search_result') && text.includes('筛选') && cards > 0;
})()
'@
        if (-not (Wait-PageCondition -Socket $socket -CommandId ([ref]$commandId) -Expression $closeReadyExpression -TimeoutSeconds $PageReadyTimeoutSeconds)) {
          Write-Warning ("[$keyword] 点击关闭按钮后未确认回到搜索结果页，停止当前地点。")
          $stopAfterCurrent = $true
          break
        }
        Write-Host "  detail closed; search results restored; continuing current place"
        if ($BetweenNotesSeconds -gt 0) {
          Write-Host ("  waiting {0}s before the next note" -f $BetweenNotesSeconds)
          Start-Sleep -Seconds $BetweenNotesSeconds
        }
      }
    }

    $captures += [ordered]@{
      keyword = $keyword
      captured_at = (Get-Date).ToUniversalTime().ToString('o')
      url = $snapshot.url
      title = $snapshot.title
      target_place = $targetPlace
      note_type_mode = $noteTypeMode
      sort_mode = $sortMode
      blocked_or_incomplete = $blocked
      visible_text = $snapshot.text
      visible_links = $snapshot.links
      raw_search_file = $searchRawPath
      candidate_analysis = $candidateAnalysis
      notes = $notes
    }

    $pageStatus = 'captured'
    if ($stopAfterCurrent) { $pageStatus = 'manual check required' }
    Write-Host ("[{0}] {1} | visible links {2} | status {3}" -f $keyword, $snapshot.title, @($snapshot.links).Count, $pageStatus)
    if ($stopAfterCurrent) {
      Write-Warning 'The page shows a login/captcha/restriction/load failure signal. Collection stopped.'
      break
    }
    Wait-BetweenPlaces -Seconds $BetweenPlacesSeconds
  }
} finally {
  $socket.Dispose()
}

$json = $captures | ConvertTo-Json -Depth 20
Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8
Write-Host "Capture saved to: $OutputPath"
