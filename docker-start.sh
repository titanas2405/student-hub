#!/usr/bin/env bash
# Student Hub in Docker (Linux/macOS): everything is downloaded into the container (first time about 10-20 minutes),
# then the app starts and opens in the browser.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v docker >/dev/null; then
  echo "Docker is not installed: https://docs.docker.com/engine/install/ (Linux) or Docker Desktop (macOS)."; exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker isn't running: start Docker Desktop, or: sudo systemctl start docker"; exit 1; }
echo "Building and starting Student Hub. The first time this downloads everything and takes a while..."
docker compose up -d --build
for _ in $(seq 1 60); do curl -fs http://127.0.0.1:8765/ >/dev/null 2>&1 && break; sleep 2; done
(xdg-open http://127.0.0.1:8765 || open http://127.0.0.1:8765) >/dev/null 2>&1 || true
echo "Student Hub is running at http://127.0.0.1:8765"
echo "First time only: ./docker-signin.sh to sign in to the AI and GitHub. Stop it with: docker compose down"
