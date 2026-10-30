#!/usr/bin/env bash
# Sign in to the AI CLIs and GitHub inside the Student Hub container (once; the logins are kept).
cd "$(dirname "$0")"
ask() { local a; read -r -p "$1 [y/N] " a; [[ $a =~ ^[Yy] ]]; }
echo "Sign in to Claude: follow the link it shows, then type /exit."
docker compose exec -it student-hub claude
ask "Sign in to ChatGPT Codex too?" && docker compose exec -it student-hub codex login
ask "Sign in to Gemini too? (type /quit when done)" && docker compose exec -it student-hub gemini
ask "Sign in to GitHub for Projects?" && docker compose exec -it student-hub gh auth login
