<# : Student Hub installer for Windows. Double-click this file: it installs everything and adds a Start button.
@echo off
set "HUB_DIR=%~dp0"
set "HUB_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText($env:HUB_SELF))"
set "HUB_CODE=%errorlevel%"
if not defined CI pause
exit /b %HUB_CODE%
#>
# Everything below is PowerShell (the lines above are the double-click part for Windows).
Set-Location $env:HUB_DIR
$ProgressPreference = 'SilentlyContinue'   # PowerShell 5.1 draws progress over the messages and downloads slowly
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Start-Transcript -Path (Join-Path $env:HUB_DIR 'install-log.txt') | Out-Null

$steps = 11
$script:step = 0
$script:missing = @()
function Step($text) { $script:step++; Write-Host "`n[$script:step/$steps] $text" -ForegroundColor Cyan }
function Info($text) { Write-Host "      $text" }
function Warn($text) { Write-Host "      $text" -ForegroundColor Yellow; $script:missing += $text }
# Programs by their full path. Never name a function like a program: PowerShell would call the function instead.
function Find-Program($name) {
    $found = Get-Command "$name.exe", "$name.cmd" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    return $null
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Add-UserPath($folder) {
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $user) { $user = '' }
    if (($user -split ';') -notcontains $folder) {
        [Environment]::SetEnvironmentVariable('Path', ($user.TrimEnd(';') + ';' + $folder).TrimStart(';'), 'User')
    }
    Refresh-Path
}
function Install-WithWinget($id, $name) {
    $winget = Find-Program 'winget'
    if (-not $winget) { Warn "$name not installed: winget is missing (install 'App Installer' from the Microsoft Store)."; return $false }
    Info "Installing $name. This can take a few minutes."
    Info 'If Windows asks for permission (a shield icon may blink in the taskbar), click Yes.'
    & $winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Host
    $code = $LASTEXITCODE
    Refresh-Path
    if ($code -eq 0 -or $code -eq -1978335189) { return $true }   # -1978335189: already installed
    Warn "$name could not be installed (winget code $code)."
    return $false
}
function Test-Python($exe, $extra) {
    if (-not $exe -or $exe -like '*\WindowsApps\*') { return $false }   # skip the Microsoft Store shortcut
    & $exe @extra -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" *> $null
    return $LASTEXITCODE -eq 0
}
function Find-Python {
    if (Test-Python (Find-Program 'py') @('-3')) { return @{ exe = (Find-Program 'py'); args = @('-3') } }
    if (Test-Python (Find-Program 'python') @()) { return @{ exe = (Find-Program 'python'); args = @() } }
    return $null
}

Write-Host 'Student Hub installer' -ForegroundColor Cyan
Info 'It installs everything Student Hub uses. No questions; a log is saved in install-log.txt.'

Step 'Python'
$python = Find-Python
if (-not $python) {
    Install-WithWinget 'Python.Python.3.12' 'Python 3.12' | Out-Null
    $python = Find-Python
}
if (-not $python) {
    Write-Host '      Python is missing. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and run this again.' -ForegroundColor Red
    Stop-Transcript | Out-Null
    exit 1
}
$pyExe = $python.exe; $pyArgs = $python.args
function Invoke-Python { & $pyExe @pyArgs @args }
Info "Using $(Invoke-Python --version 2>&1)"

Step 'Certificate checks for the university servers (truststore)'
Invoke-Python -m pip install --user --disable-pip-version-check --quiet --upgrade truststore
Invoke-Python -c "import truststore" *> $null
if ($LASTEXITCODE -eq 0) { Info 'Ready.' } else { Warn 'truststore could not be installed (mail may show certificate errors).' }

Step 'Git'
if (Find-Program 'git') { Info 'Already installed.' } else { Install-WithWinget 'Git.Git' 'Git' | Out-Null }

Step 'GitHub CLI'
if (Find-Program 'gh') { Info 'Already installed.' } else { Install-WithWinget 'GitHub.cli' 'GitHub CLI' | Out-Null }

Step 'LibreOffice (Word to PDF, Office previews)'
if (Test-Path "$env:ProgramFiles\LibreOffice\program\soffice.exe") { Info 'Already installed.' }
else { Install-WithWinget 'TheDocumentFoundation.LibreOffice' 'LibreOffice' | Out-Null }

Step 'PDF tools (Poppler)'
if (Find-Program 'pdfinfo') { Info 'Already installed.' }
elseif (Install-WithWinget 'oschwartz10612.Poppler' 'Poppler') {
    $pdfinfo = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter pdfinfo.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pdfinfo) { Add-UserPath $pdfinfo.DirectoryName }
}
if (-not (Find-Program 'gswin64c') -and -not (Test-Path "$env:ProgramFiles\gs")) {
    Info 'Ghostscript (PDF compression only) is not in winget; you can add it later from https://ghostscript.com/releases/gsdnld.html'
}

Step 'Claude Code'
$localBin = Join-Path $env:USERPROFILE '.local\bin'
if (-not (Test-Path (Join-Path $localBin 'claude.exe')) -and -not (Find-Program 'claude')) {
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression }
    catch { Warn "Claude Code could not be installed: $($_.Exception.Message)" }
} else { Info 'Already installed.' }
if (Test-Path (Join-Path $localBin 'claude.exe')) { Add-UserPath $localBin }

Step 'ChatGPT Codex and Gemini CLIs (Node.js)'
if (-not (Find-Program 'npm')) { Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js' | Out-Null }
$npm = Find-Program 'npm'
if ($npm) {
    & $npm install -g --no-fund --no-audit @openai/codex @google/gemini-cli | Out-Host
    if ($LASTEXITCODE -ne 0) { Warn 'Codex/Gemini could not be installed with npm.' } else { Info 'Ready.' }
    Refresh-Path
} else { Warn 'Node.js is missing, so Codex and Gemini were skipped.' }

Step 'Whisper (lecture subtitles on this computer)'
# Whisper's libraries need a Python they have builds for, so it gets its own Python 3.12 environment.
$whisper = Join-Path $env:LOCALAPPDATA 'student-hub\whisper'
$whisperPy = Join-Path $whisper 'Scripts\python.exe'
function Test-Whisper {
    if (-not (Test-Path $whisperPy)) { return $false }
    & $whisperPy -c "import faster_whisper" *> $null
    return $LASTEXITCODE -eq 0
}
if (Test-Whisper) { Info 'Already installed.' }
else {
    if (Test-Path $whisper) { Remove-Item -Recurse -Force $whisper }
    $launcher = Find-Program 'py'
    $version = $null
    foreach ($v in '3.12', '3.11', '3.13') { if (-not $version -and (Test-Python $launcher @("-$v"))) { $version = $v } }
    if (-not $version) {
        Install-WithWinget 'Python.Python.3.12' 'Python 3.12 (for Whisper)' | Out-Null
        $launcher = Find-Program 'py'
        if (Test-Python $launcher @('-3.12')) { $version = '3.12' }
    }
    if ($version) {
        Info "Installing faster-whisper with Python $version. This takes a few minutes."
        & $launcher "-$version" -m venv $whisper
        & $whisperPy -m pip install --disable-pip-version-check --quiet faster-whisper
        if (Test-Whisper) { Info 'Ready.' }
        else { Warn 'Whisper could not be installed.'; Remove-Item -Recurse -Force $whisper -ErrorAction SilentlyContinue }
    } else { Warn 'Whisper needs Python 3.12, which could not be installed.' }
}

Step 'Start button on the desktop'
try {
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Student Hub.lnk'))
    $link.TargetPath = Join-Path $env:HUB_DIR 'start.bat'
    $link.WorkingDirectory = $env:HUB_DIR
    $link.Description = 'Start Student Hub'
    $link.Save()
    Info "'Student Hub' is on your desktop: double-click it to start."
} catch { Warn "No desktop shortcut ($($_.Exception.Message)); double-click start.bat instead." }

Step 'Setup check'
Invoke-Python -X utf8 server.py --check
$failed = $LASTEXITCODE -ne 0
Stop-Transcript | Out-Null

Write-Host ''
if ($failed) {
    Write-Host 'Something required is missing (marked !! above). Send install-log.txt if you need help.' -ForegroundColor Red
    exit 1
}
if ($script:missing.Count) {
    Write-Host 'Installed, except:' -ForegroundColor Yellow
    $script:missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
Write-Host 'Student Hub is installed.' -ForegroundColor Green

if (-not $env:CI) {
    # Sign in to Claude once (it opens its own window), then start the app.
    $claude = Join-Path $localBin 'claude.exe'
    if (-not (Test-Path $claude)) { $claude = Find-Program 'claude' }
    if ($claude) {
        Write-Host 'A Claude window opens: sign in once, then type /exit.'
        Start-Process powershell -ArgumentList '-NoExit', '-Command', "& '$claude'"
    }
    Write-Host 'Starting Student Hub...'
    Start-Process (Join-Path $env:HUB_DIR 'start.bat') -WorkingDirectory $env:HUB_DIR
}
exit 0
