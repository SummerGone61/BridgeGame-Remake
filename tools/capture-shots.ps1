# ============================================================
# tools/capture-shots.ps1 —— 用无头 Chrome 批量截取"主题 × 界面状态"画面
#
# 说明：截图目标页是 tools/preview.html（开发沙盒页），
#       它复用正式的外观层代码，通过 URL 参数选择主题与场景，
#       因此不需要在正式页面里留任何调试入口。
#
# 用法（在仓库根目录）：
#   pwsh -File tools/capture-shots.ps1
#   pwsh -File tools/capture-shots.ps1 -Themes neon,ink -Scenes play,settings
# ============================================================
param(
  [string[]]$Themes = @("neon", "ink", "clay"),
  [string[]]$Scenes = @("play", "start", "settings", "over"),
  [int]$Width = 1280,
  [int]$Height = 820,
  [string]$OutDir = ".tmp-shots"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root $OutDir
$profile = Join-Path $out "profile"
New-Item -ItemType Directory -Force -Path $out, $profile | Out-Null

$chrome = $null
foreach ($c in @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe")) {
  if (Test-Path $c) { $chrome = $c; break }
}
if (-not $chrome) { throw "未找到 Chrome / Edge，无法截图" }

$page = (Join-Path $root "tools/preview.html").Replace("\", "/")
$made = @()

foreach ($theme in $Themes) {
  foreach ($scene in $Scenes) {
    $name = "$theme-$scene.png"
    $target = (Join-Path $out $name).Replace("\", "/")
    $url = "file:///$page" + "?theme=$theme&scene=$scene"
    $chromeArgs = @(
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      "--no-default-browser-check", "--disable-extensions", "--disable-sync",
      "--force-device-scale-factor=1", "--user-data-dir=$profile",
      "--window-size=$Width,$Height", "--virtual-time-budget=2500",
      "--screenshot=$target", $url
    )
    & $chrome @chromeArgs 2>&1 | Out-Null
    if (Test-Path $target) {
      $size = (Get-Item $target).Length
      $made += [pscustomobject]@{ File = $name; Bytes = $size }
    } else {
      $made += [pscustomobject]@{ File = $name; Bytes = -1 }
    }
  }
}

# ---- 画布像素自检：抓取页面内 <pre id="selfcheck"> 的 JSON ----
$checks = @()
foreach ($theme in $Themes) {
  $url = "file:///$page" + "?theme=$theme&scene=play"
  $dumpArgs = @(
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--force-device-scale-factor=1", "--user-data-dir=$profile",
    "--window-size=$Width,$Height", "--virtual-time-budget=3000",
    "--dump-dom", $url
  )
  $dom = (& $chrome @dumpArgs 2>$null | Out-String)
  $m = [regex]::Match($dom, '(?s)<pre id="selfcheck">(.*?)</pre>')
  $jsonPath = Join-Path $out "selfcheck-$theme.json"
  if ($m.Success) {
    $json = $m.Groups[1].Value
    $json = [System.Net.WebUtility]::HtmlDecode($json).Trim()
    Set-Content -Path $jsonPath -Value $json -Encoding UTF8
    $verdict = "?"
    try { $verdict = (ConvertFrom-Json $json).failures.Count } catch { $verdict = "解析失败" }
    $checks += [pscustomobject]@{ Theme = $theme; Json = $jsonPath; Failures = $verdict }
  } else {
    Set-Content -Path $jsonPath -Value "" -Encoding UTF8
    $checks += [pscustomobject]@{ Theme = $theme; Json = $jsonPath; Failures = "未取到" }
  }
}

$made | Format-Table -AutoSize | Out-String -Width 100
"---- 画面自检（failures 为 0 表示通过）----"
$checks | Format-Table -AutoSize | Out-String -Width 120

# ---- 渲染开销基准（每主题同步跑若干帧，量一帧绘制耗时）----
$bench = @()
foreach ($theme in $Themes) {
  $url = "file:///$page" + "?theme=$theme&scene=play&bench=1"
  $benchArgs = @(
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--force-device-scale-factor=1", "--user-data-dir=$profile",
    "--window-size=$Width,$Height", "--dump-dom", $url
  )
  $dom = (& $chrome @benchArgs 2>$null | Out-String)
  $m = [regex]::Match($dom, '(?s)<pre id="bench">(.*?)</pre>')
  if ($m.Success) {
    $json = ([System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)).Trim()
    Set-Content -Path (Join-Path $out "bench-$theme.json") -Value $json -Encoding UTF8
    $o = ConvertFrom-Json $json
    $bench += [pscustomobject]@{ Theme = $theme; MsPerFrame = $o.msPerDraw; Budget = $o.fps60Budget }
  } else {
    $bench += [pscustomobject]@{ Theme = $theme; MsPerFrame = "未取到"; Budget = "-" }
  }
}
"---- 渲染开销（ms/帧；Budget = 占 60fps 单帧预算 16.7ms 的比例）----"
$bench | Format-Table -AutoSize | Out-String -Width 120
"输出目录：$out"
