@echo off
rem Student Hub in Docker: everything is downloaded into the container (first time about 10-20 minutes),
rem then the app starts and opens in the browser. Needs Docker Desktop, which this installs if it is missing.
cd /d "%~dp0"
where docker >nul 2>nul || (
  echo Docker is not installed. Installing Docker Desktop with winget...
  winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
  echo.
  echo Restart Windows, open Docker Desktop once and finish its setup, then run this file again.
  pause
  exit /b 1
)
docker info >nul 2>nul && goto ready
echo Starting Docker Desktop...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,60) do (
  docker info >nul 2>nul && goto ready
  timeout /t 3 /nobreak >nul
)
echo Docker did not start. Open Docker Desktop, wait until it says "Engine running", then run this file again.
pause
exit /b 1
:ready
echo Building and starting Student Hub. The first time this downloads everything and takes a while...
docker compose up -d --build
if errorlevel 1 (
  echo Docker could not build or start Student Hub. Copy the messages above and send them.
  pause
  exit /b 1
)
echo Waiting for Student Hub...
for /l %%i in (1,1,60) do (
  curl -fs http://127.0.0.1:8765/ >nul 2>nul && goto up
  timeout /t 2 /nobreak >nul
)
:up
start "" http://127.0.0.1:8765
echo.
echo Student Hub is running at http://127.0.0.1:8765 (it keeps running in Docker after you close this window).
echo First time only: double-click docker-signin.bat to sign in to the AI and GitHub.
echo To stop it: docker compose down
pause
