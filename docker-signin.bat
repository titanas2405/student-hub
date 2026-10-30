@echo off
rem Sign in to the AI CLIs and GitHub inside the Student Hub container (once; the logins are kept).
cd /d "%~dp0"
echo Sign in to Claude: follow the link it shows, then type /exit.
docker compose exec -it student-hub claude
echo.
choice /m "Sign in to ChatGPT Codex too"
if not errorlevel 2 docker compose exec -it student-hub codex login
choice /m "Sign in to Gemini too (type /quit when done)"
if not errorlevel 2 docker compose exec -it student-hub gemini
choice /m "Sign in to GitHub for Projects"
if not errorlevel 2 docker compose exec -it student-hub gh auth login
pause
