# Обновить программу Freefield на этом компьютере из репозитория (GitHub, ветка main).
# Запуск — вставить в PowerShell одну строку:
#   irm https://raw.githubusercontent.com/zuevilia808-collab/freefield/main/pc/update.ps1 | iex
# Берёт pc/mcp/*.js, *.mjs и подпапки модулей (montage/…), прежние версии изменённых файлов кладёт в Freefield\mcp\backup-<дата>.
# Настройки (config.json), профили Chrome и готовые файлы не трогает. Кладёт рядом «Обновить Freefield.cmd» — дальше двойным щелчком.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'zuevilia808-collab/freefield'
$desk = [Environment]::GetFolderPath('Desktop')
$dir = @("$desk\Freefield\mcp", "$env:USERPROFILE\Desktop\Freefield\mcp", "$env:USERPROFILE\OneDrive\Desktop\Freefield\mcp") |
  Where-Object { Test-Path (Join-Path $_ 'server.js') } | Select-Object -First 1
if (-not $dir) { Write-Host 'Не нашёл папку Freefield\mcp на рабочем столе — обновите файлы вручную (pc/README.md).' -ForegroundColor Red; return }
Write-Host "Freefield: $dir"
# всё дерево одним запросом: pc/mcp/*.js и подпапки модулей (montage/, montage/templates/…), кроме dev/
$tree = Invoke-RestMethod "https://api.github.com/repos/$repo/git/trees/main?recursive=1" -Headers @{ 'User-Agent' = 'freefield-update' }
$bak = Join-Path $dir ('backup-' + (Get-Date -Format 'yyyy-MM-dd-HH-mm'))
$n = 0
foreach ($f in $tree.tree) {
  if ($f.type -ne 'blob' -or -not $f.path.StartsWith('pc/mcp/')) { continue }
  $rel = $f.path.Substring(7)
  if ($rel -notmatch '^([\w-]+/)*[\w.-]+\.(m?js|json|html|css)$' -or $rel.StartsWith('dev/') -or $rel -in @('package.json', 'package-lock.json')) { continue }
  $tmp = Join-Path $env:TEMP ('freefield-' + ($rel -replace '/', '-'))
  Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/pc/mcp/$rel" -OutFile $tmp -UseBasicParsing
  $dst = Join-Path $dir ($rel -replace '/', '\')
  if ((Test-Path $dst) -and ((Get-FileHash $dst).Hash -eq (Get-FileHash $tmp).Hash)) { Remove-Item $tmp; continue }
  if (Test-Path $dst) { $b = Join-Path $bak ($rel -replace '/', '\'); New-Item -ItemType Directory -Force (Split-Path $b) | Out-Null; Copy-Item $dst $b }
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Move-Item -Force $tmp $dst
  Write-Host "  обновлён $rel"
  $n++
}
# на будущее — обновление двойным щелчком (или кнопкой в приложении Freefield)
$cmd = Join-Path (Split-Path $dir) 'Обновить Freefield.cmd'
Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/pc/update.cmd" -OutFile $cmd -UseBasicParsing
if ($n) { Write-Host "Готово: обновлено файлов — $n. Закройте Claude Desktop полностью (значок у часов -> «Выход») и откройте снова." -ForegroundColor Green }
else { Write-Host 'Программа уже новейшая.' -ForegroundColor Green }
