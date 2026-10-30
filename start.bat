@echo off
rem Starts Student Hub and opens it in the browser. Keep this window open while you use the app.
cd /d "%~dp0"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python was not found. Double-click install.bat first.
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8765"
%PY% -X utf8 server.py
pause
