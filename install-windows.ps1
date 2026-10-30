# Student Hub installer for Windows. Double-click install-windows.bat (or run:
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1 [-Whisper] [-NoSignIn])
# It asks no questions: it installs Python (if needed), truststore, Git, the GitHub CLI, LibreOffice, Ghostscript,
# Poppler and Claude Code, adds a desktop shortcut and runs the setup check. At the end it opens Claude and GitHub
# sign-in in their own windows. -Whisper also installs local lecture subtitles (about 1 GB).
param([switch]$Whisper, [switch]$NoSignIn)

Set-Location $PSScriptRoot
$ProgressPreference = 'SilentlyContinue'   # PowerShell 5.1 draws progress over the messages and downloads slowly
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Start-Transcript -Path (Join-Path $PSScriptRoot 'install-log.txt') | Out-Null

$script:step = 0
$script:problems = @()
function Step($text) { $script:step++; Write-Host "`n[$script:step/9] $text" -ForegroundColor Cyan }
function Info($text) { Write-Host "      $text" }
function Warn($text) { Write-Host "      $text" -ForegroundColor Yellow; $script:problems += $text }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
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
function Install-WithWinget($id, $name) {   # not named 'winget': PowerShell would call this function instead
    if (-not (Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue)) {
        Warn "$name not installed: winget is missing (install 'App Installer' from the Microsoft Store)."
        return $false
    }
    Info "Installing $name with winget. This can take a few minutes."
    Info "If Windows asks for permission (a shield icon may blink in the taskbar), click Yes."
    winget.exe install -e --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Host   # shown, not returned
    $code = $LASTEXITCODE
    Refresh-Path
    # -1978335189 (0x8A15002B): already installed, nothing newer.
    if ($code -eq 0 -or $code -eq -1978335189) { return $true }
    Warn "$name could not be installed by winget (code $code)."
    return $false
}
function Find-WingetId($query) {   # the package ID winget lists for a search, e.g. for "ghostscript"
    $lines = winget.exe search $query --source winget --accept-source-agreements 2>$null
    foreach ($line in $lines) {
        $match = [regex]::Match([string]$line, '\s([A-Za-z0-9-]+\.[A-Za-z0-9.-]*' + [regex]::Escape($query) + '[A-Za-z0-9.-]*)\s', 'IgnoreCase')
        if ($match.Success) { return $match.Groups[1].Value }
    }
    return $null
}
function Find-Program($name) {   # the real program's full path, never a function or alias of the same name
    $found = Get-Command "$name.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    return $null
}
function Test-Python($exe, $extra) {
    if (-not $exe) { return $false }
    if ($exe -like '*\WindowsApps\*') { return $false }   # the Microsoft Store shortcut, not a real Python
    & $exe @extra -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" *> $null
    return $LASTEXITCODE -eq 0
}

Write-Host 'Student Hub installer for Windows' -ForegroundColor Cyan
Info 'No questions: it installs everything recommended. A log is saved in install-log.txt.'

# 1. Python
Step 'Python'
$pyExe = $null; $pyArgs = @()
if (Test-Python (Find-Program 'py') @('-3')) { $pyExe = Find-Program 'py'; $pyArgs = @('-3') }
elseif (Test-Python (Find-Program 'python') @()) { $pyExe = Find-Program 'python' }
else {
    Info 'Python 3.9 or newer was not found.'
    if (Install-WithWinget 'Python.Python.3.12' 'Python 3.12') {
        if (Test-Python (Find-Program 'py') @('-3')) { $pyExe = Find-Program 'py'; $pyArgs = @('-3') }
        elseif (Test-Python (Find-Program 'python') @()) { $pyExe = Find-Program 'python' }
    }
}
if (-not $pyExe) {
    Write-Host '      Python is missing. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.' -ForegroundColor Red
    Stop-Transcript | Out-Null
    exit 1
}
function Invoke-Python { & $pyExe @pyArgs @args }   # not named 'py': that would call itself
Info "Using: $(Invoke-Python --version 2>&1) ($pyExe $pyArgs)"

# 2. truststore: Windows' own certificate checks for the university servers
Step 'Certificate checks for the university servers (truststore)'
Invoke-Python -c "import truststore" *> $null
if ($LASTEXITCODE -eq 0) { Info 'Already installed.' }
else {
    Invoke-Python -m pip install --user --disable-pip-version-check --quiet truststore
    Invoke-Python -c "import truststore" *> $null
    if ($LASTEXITCODE -eq 0) { Info 'Installed.' } else { Warn 'truststore could not be installed (mail may show certificate errors).' }
}

# 3-4. Projects
Step 'Git'
if (Have git) { Info "Already installed: $((Get-Command git).Source)" } else { Install-WithWinget 'Git.Git' 'Git' | Out-Null }
Step 'GitHub CLI'
if (Have gh) { Info "Already installed: $((Get-Command gh).Source)" } else { Install-WithWinget 'GitHub.cli' 'GitHub CLI' | Out-Null }

# 5. Documents and PDFs
Step 'LibreOffice, Ghostscript and Poppler (Word to PDF, PDF tools)'
if (Test-Path "$env:ProgramFiles\LibreOffice\program\soffice.exe") { Info 'LibreOffice is already installed.' }
else { Install-WithWinget 'TheDocumentFoundation.LibreOffice' 'LibreOffice' | Out-Null }
if ((Have gswin64c) -or (Test-Path "$env:ProgramFiles\gs")) { Info 'Ghostscript is already installed.' }
elseif (Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue) {
    $gsId = Find-WingetId 'ghostscript'
    if ($gsId) { Install-WithWinget $gsId 'Ghostscript' | Out-Null }
    else { Warn 'Ghostscript (only for PDF compression) is not in winget: download the 64-bit Windows installer from https://ghostscript.com/releases/gsdnld.html' }
}
if (Have pdfinfo) { Info 'Poppler is already installed.' }
elseif (Install-WithWinget 'oschwartz10612.Poppler' 'Poppler') {
    $poppler = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter pdfinfo.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($poppler) { Add-UserPath $poppler.DirectoryName; Info "Poppler added to PATH: $($poppler.DirectoryName)" }
}

# 6. Claude Code
Step 'Claude Code (the AI used by the assistant and AI tools)'
$localBin = Join-Path $env:USERPROFILE '.local\bin'
if (-not (Test-Path (Join-Path $localBin 'claude.exe')) -and -not (Have claude)) {
    Info 'Downloading the official Claude Code installer...'
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression }
    catch { Warn "Claude Code could not be installed: $($_.Exception.Message)" }
}
if (Test-Path (Join-Path $localBin 'claude.exe')) { Add-UserPath $localBin; Info "Claude Code: $localBin\claude.exe" }
elseif (Have claude) { Info "Claude Code: $((Get-Command claude).Source)" }

# 7. Whisper (only with -Whisper)
Step 'Whisper for lecture subtitles'
$whisperDir = Join-Path $env:LOCALAPPDATA 'student-hub\whisper'
if (Test-Path (Join-Path $whisperDir 'Scripts\python.exe')) { Info 'Already installed.' }
elseif ($Whisper) {
    Info 'Installing faster-whisper (a few minutes)...'
    Invoke-Python -m venv $whisperDir
    & (Join-Path $whisperDir 'Scripts\python.exe') -m pip install --disable-pip-version-check --quiet faster-whisper
    if ($LASTEXITCODE -ne 0) { Warn 'Whisper could not be installed.' }
}
else { Info 'Skipped (optional). Run install-windows.bat -Whisper to add it, or use a free Groq key in the app.' }

# 8. Desktop shortcut
Step 'Desktop shortcut'
try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Student Hub.lnk'))
    $link.TargetPath = Join-Path $PSScriptRoot 'start-windows.bat'
    $link.WorkingDirectory = $PSScriptRoot
    $link.Description = 'Student Hub'
    $link.Save()
    Info "Created 'Student Hub' on your desktop."
} catch { Warn "No desktop shortcut: $($_.Exception.Message). Use start-windows.bat instead." }

# 9. Setup check
Step 'Setup check'
Invoke-Python -X utf8 server.py --check
$checkFailed = $LASTEXITCODE -ne 0

Stop-Transcript | Out-Null
Write-Host ''
if ($checkFailed) {
    Write-Host 'Some required parts are missing (marked !! above). Send install-log.txt if you need help.' -ForegroundColor Red
    exit 1
}
if ($script:problems.Count) {
    Write-Host 'Installed, with these optional parts missing:' -ForegroundColor Yellow
    $script:problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
Write-Host 'Student Hub is installed. Start it with the Student Hub shortcut on your desktop.' -ForegroundColor Green

# Sign-in needs you, so it opens in its own windows (the installer doesn't wait for it).
if (-not $NoSignIn) {
    $claude = if (Test-Path (Join-Path $localBin 'claude.exe')) { Join-Path $localBin 'claude.exe' } elseif (Have claude) { (Get-Command claude).Source }
    if ($claude) {
        Write-Host 'Opening Claude to sign in (once). Follow the link it shows, then type /exit.'
        Start-Process powershell -ArgumentList '-NoExit', '-Command', "& '$claude'"
    }
    if (Have gh) {
        gh auth status *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Opening GitHub sign-in (for Projects).'
            Start-Process powershell -ArgumentList '-NoExit', '-Command', 'gh auth login'
        }
    }
}
exit 0
