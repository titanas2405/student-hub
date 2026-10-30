#!/usr/bin/env bash
# Starts Student Hub and opens it in the browser. Keep this window open while you use the app.
cd "$(dirname "$(readlink -f "$0")")"
(sleep 2; xdg-open http://127.0.0.1:8765 >/dev/null 2>&1 || open http://127.0.0.1:8765 >/dev/null 2>&1 || true) &
exec python3 server.py
