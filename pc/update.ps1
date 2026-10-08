# Обновить программу Freefield на этом компьютере из репозитория (GitHub, ветка main).
# Запуск — вставить в PowerShell одну строку:
#   irm https://raw.githubusercontent.com/zuevilia808-collab/freefield/main/pc/update.ps1 | iex
# Берёт все pc/mcp/*.js и *.mjs, прежние версии изменённых файлов кладёт в Freefield\mcp\backup-<дата>.
# Настройки (config.json), профили Chrome и готовые файлы не трогает. Кладёт рядом «Обновить Freefield.cmd» — дальше двойным щелчком.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'zuevilia808-collab/freefield'
$desk = [Environment]::GetFolderPath('Desktop')
$dir = @("$desk\Freefield\mcp", "$env:USERPROFILE\Desktop\Freefield\mcp", "$env:USERPROFILE\OneDrive\Desktop\Freefield\mcp") |
  Where-Object { Test-Path (Join-Path $_ 'server.js') } | Select-Object -First 1
if (-not $dir) { Write-Host 'Не нашёл папку Freefield\mcp на рабочем столе — обновите файлы вручную (pc/README.md).' -ForegroundColor Red; return }
Write-Host "Freefield: $dir"
$list = Invoke-RestMethod "https://api.github.com/repos/$repo/contents/pc/mcp?ref=main" -Headers @{ 'User-Agent' = 'freefield-update' }
$bak = Join-Path $dir ('backup-' + (Get-Date -Format 'yyyy-MM-dd-HH-mm'))
$n = 0
foreach ($f in $list) {
  if ($f.type -ne 'file' -or $f.name -notmatch '^[\w.-]+\.m?js$') { continue }
  $tmp = Join-Path $env:TEMP ('freefield-' + $f.name)
  Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/pc/mcp/$($f.name)" -OutFile $tmp -UseBasicParsing
  $dst = Join-Path $dir $f.name
  if ((Test-Path $dst) -and ((Get-FileHash $dst).Hash -eq (Get-FileHash $tmp).Hash)) { Remove-Item $tmp; continue }
  if (Test-Path $dst) { New-Item -ItemType Directory -Force $bak | Out-Null; Copy-Item $dst $bak }
  Move-Item -Force $tmp $dst
  Write-Host "  обновлён $($f.name)"
  $n++
}
# на будущее — обновление двойным щелчком (или кнопкой в приложении Freefield)
$cmd = Join-Path (Split-Path $dir) 'Обновить Freefield.cmd'
Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/pc/update.cmd" -OutFile $cmd -UseBasicParsing
if ($n) { Write-Host "Готово: обновлено файлов — $n. Закройте Claude Desktop полностью (значок у часов -> «Выход») и откройте снова." -ForegroundColor Green }
else { Write-Host 'Программа уже новейшая.' -ForegroundColor Green }
