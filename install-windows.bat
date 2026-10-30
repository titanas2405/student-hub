@echo off
rem Double-click to install what Student Hub uses on Windows (runs install-windows.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
pause
