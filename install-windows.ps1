# Student Hub installer for Windows. Run it once before you sign in: double-click install-windows.bat,
# or in PowerShell:  powershell -ExecutionPolicy Bypass -File install-windows.ps1 [-Yes]
# It installs what the app uses with winget, lets you sign in to an AI CLI and GitHub, adds a desktop shortcut and
# finishes with the setup check. -Yes installs the recommended parts without asking.
param([switch]$Yes)
Set-Location $PSScriptRoot
$ProgressPreference = 'SilentlyContinue'   # PowerShell 5.1 draws progress over the messages (and downloads slowly)
Start-Transcript -Path (Join-Path $PSScriptRoot 'install-log.txt') | Out-Null
$script:step = 0
function Step($text) { $script:step++; Write-Host "`n[$script:step/8] $text" -ForegroundColor Cyan }
function Info($text) { Write-Host "      $text" }

function Say($text) { Write-Host "`n$text" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Ask($question, $default = $true) {
    if ($Yes) { return $default }
    $hint = if ($default) { 'Y/n' } else { 'y/N' }
    $answer = Read-Host "$question [$hint]"
    if (-not $answer) { return $default }
    return $answer -match '^[Yy]'
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Add-UserPath($folder) {
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($user -split ';') -notcontains $folder) {
        [Environment]::SetEnvironmentVariable('Path', ($user.TrimEnd(';') + ';' + $folder), 'User')
    }
    Refresh-Path
}
function Winget($id) {
    Info "Installing $id with winget. This can take a few minutes; winget shows its progress below."
    if (-not (Have winget)) {
        Write-Host "winget is missing: install 'App Installer' from the Microsoft Store, then run this again." -ForegroundColor Yellow
        return $false
    }
    winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent
    $ok = $LASTEXITCODE -eq 0
    if (-not $ok) { Write-Host "winget could not install $id (code $LASTEXITCODE)." -ForegroundColor Yellow }
    Refresh-Path
    return $ok
}
function Test-Python($command) {
    if (-not (Have $command[0])) { return $false }
    $rest = @($command | Select-Object -Skip 1)
    & $command[0] @rest -c "import sys; sys.exit(sys.version_info < (3, 9))" 2>$null
    return $LASTEXITCODE -eq 0
}
function Find-Python {
    if (Test-Python @('py', '-3')) { return ,@('py', '-3') }
    if (Test-Python @('python')) { return ,@('python') }
    return $null
}

Say 'Student Hub installer for Windows'
Info "A log of everything is saved in install-log.txt. Press Enter to accept the answer in capitals ([Y/n] = yes)."

# 1. Python (required).
Step 'Python'
Info 'Looking for Python 3.9 or newer (py or python)...'
$python = Find-Python
if (-not $python) {
    Say 'Python 3.9 or newer is required. Installing Python 3.12...'
    Winget 'Python.Python.3.12' | Out-Null
    $python = Find-Python
    if (-not $python) {
        Write-Host 'Python is still missing. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.' -ForegroundColor Red
        exit 1
    }
}
$pythonArgs = @($python | Select-Object -Skip 1)
function Py { & $python[0] @pythonArgs @args }
Info "Found: $(Py --version)"

# 2. Windows' own certificate checks for the university servers (avoids SSLCertVerificationError).
Step 'Certificate checks (truststore)'
Py -c "import truststore" 2>$null
if ($LASTEXITCODE -ne 0) {
    Info 'Installing truststore, so Python uses Windows certificate checks for imap.uoa.gr and eClass...'
    Py -m pip install --user --disable-pip-version-check truststore
} else { Info 'Already installed.' }

# 3. Projects: git and the GitHub CLI.
Step 'Projects: Git and GitHub CLI'
if ((Have git) -and (Have gh)) { Info 'Already installed.' }
if (-not ((Have git) -and (Have gh)) -and (Ask 'Projects need Git and the GitHub CLI. Install them?')) {
    if (-not (Have git)) { Winget 'Git.Git' | Out-Null }
    if (-not (Have gh)) { Winget 'GitHub.cli' | Out-Null }
}

# 4. Documents and PDFs.
Step 'Documents: LibreOffice, Ghostscript, Poppler'
$soffice = Test-Path "$env:ProgramFiles\LibreOffice\program\soffice.exe"
if ($soffice) { Info 'LibreOffice is already installed.' }
if (-not $soffice -and (Ask 'LibreOffice converts Word to PDF and previews Office files (about 350 MB). Install it?')) {
    Winget 'TheDocumentFoundation.LibreOffice' | Out-Null
}
if (Ask 'Ghostscript and Poppler compress, merge and split PDFs. Try to install them with winget?' $false) {
    if (-not (Winget 'ArtifexSoftware.GhostScript')) { Write-Host 'Get Ghostscript from https://ghostscript.com/releases/' }
    if (-not (Winget 'oschwartz10612.Poppler')) { Write-Host 'Get Poppler for Windows and add its Library\bin folder to PATH.' }
}

# 5. An AI CLI for the assistant, the AI tools and the lecture summaries.
Step 'AI CLI and sign-in'
$localBin = Join-Path $env:USERPROFILE '.local\bin'
if (Test-Path (Join-Path $localBin 'claude.exe')) { Add-UserPath $localBin }
if ((Have claude) -or (Have codex) -or (Have gemini)) { Info 'An AI CLI is already installed.' }
if (-not ((Have claude) -or (Have codex) -or (Have gemini))) {
    Info 'AI CLI (the assistant and AI tools use your own account through it)'
    Write-Host '  1) Claude Code   2) ChatGPT Codex   3) Gemini   4) skip'
    $choice = if ($Yes) { '1' } else { Read-Host 'Choose [1]' }
    if (-not $choice) { $choice = '1' }
    $ai = $null
    switch ($choice) {
        '1' { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Add-UserPath $localBin; $ai = 'claude' }
        { $_ -in '2', '3' } {
            if (-not (Have npm)) { Winget 'OpenJS.NodeJS.LTS' | Out-Null }
            if ($choice -eq '2') { npm install -g @openai/codex; $ai = 'codex' } else { npm install -g @google/gemini-cli; $ai = 'gemini' }
            Refresh-Path
        }
    }
    if ($ai -and (Have $ai) -and -not $Yes -and (Ask "Sign in to $ai now? (Type /exit when you're done.)")) {
        if ($ai -eq 'codex') { codex login } else { & $ai }
    }
}
if ((Have gh) -and -not $Yes) {
    gh auth status *> $null
    if ($LASTEXITCODE -ne 0 -and (Ask 'Sign in to GitHub for Projects now?')) { gh auth login }
}

# 6. Whisper for lecture subtitles on this computer (optional; a free Groq key also works).
Step 'Whisper for lecture subtitles (optional)'
$whisper = Join-Path $env:LOCALAPPDATA 'student-hub\whisper'
if (-not (Test-Path (Join-Path $whisper 'Scripts\python.exe')) -and (Ask 'Install Whisper for lecture subtitles on this computer (about 1 GB with the model)?' $false)) {
    Py -m venv $whisper
    & (Join-Path $whisper 'Scripts\python.exe') -m pip install faster-whisper
}

# 7. A desktop shortcut that starts the app.
Step 'Desktop shortcut'
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Student Hub.lnk'
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$link.TargetPath = Join-Path $PSScriptRoot 'start-windows.bat'
$link.WorkingDirectory = $PSScriptRoot
$link.Description = 'Student Hub'
$link.Save()
Write-Host "Added a 'Student Hub' shortcut to your desktop (or double-click start-windows.bat)."

# 8. The setup check.
Step 'Setup check'
Py -X utf8 server.py --check
$code = $LASTEXITCODE
Stop-Transcript | Out-Null
if ($code -ne 0) { Write-Host "`nFix the parts marked !! and run the installer again." -ForegroundColor Yellow; exit 1 }
Write-Host "`nDone. Start Student Hub with the shortcut on your desktop." -ForegroundColor Green
