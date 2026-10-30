@echo off
rem Student Hub for Windows: checks the setup, then starts the app and opens it in the browser.
cd /d "%~dp0"
set "PY="
where py >/dev/null 2>/dev/null && set "PY=py -3"
if not defined PY where python >/dev/null 2>/dev/null && set "PY=python"
if not defined PY (
  echo Python was not found. Install Python 3.9 or newer from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" in the installer, then run this file again.
  pause
  exit /b 1
)
%PY% -c "import truststore" >nul 2>nul || (
  echo Installing truststore, so Python uses Windows certificate checks for the university servers...
  %PY% -m pip install --user --disable-pip-version-check truststore
)
%PY% -X utf8 server.py --check
if errorlevel 1 (
  echo.
  echo Fix the parts marked !! above, then run this file again.
  pause
  exit /b 1
)
echo.
start "" cmd /c "timeout /t 2 /nobreak >/dev/null & start http://127.0.0.1:8765"
%PY% -X utf8 server.py
pause
