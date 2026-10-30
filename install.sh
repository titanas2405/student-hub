#!/usr/bin/env bash
# Student Hub installer for Linux (apt, dnf, pacman or zypper). Run it in the Student Hub folder:  ./install.sh
# It installs everything Student Hub uses (asks for your password once, for sudo), adds a Start button to the
# applications menu and the desktop, runs the setup check and starts the app.
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")"
HUB_DIR=$PWD
exec > >(tee install-log.txt) 2>&1
STEPS=10 STEP=0 MISSING=()
step() { STEP=$((STEP + 1)); printf '\n\033[1;36m[%d/%d] %s\033[0m\n' "$STEP" "$STEPS" "$*"; }
info() { echo "      $*"; }
warn() { printf '      \033[33m%s\033[0m\n' "$*"; MISSING+=("$*"); }
have() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO=sudo
if have apt-get; then PM=apt; elif have dnf; then PM=dnf; elif have pacman; then PM=pacman; elif have zypper; then PM=zypper; else PM=none; fi
packages() {  # package names for each part
  case "$PM:$1" in
    apt:python) echo python3 python3-venv python3-pip ;;
    pacman:python) echo python python-pip ;;
    *:python) echo python3 python3-pip ;;
    *:base) echo curl ca-certificates git xdg-utils ;;
    pacman:gh) echo github-cli ;;
    *:gh) echo gh ;;
    pacman:libreoffice) echo libreoffice-fresh ;;
    *:libreoffice) echo libreoffice-writer libreoffice-calc libreoffice-impress ;;
    pacman:pdf) echo ghostscript poppler ;;
    zypper:pdf) echo ghostscript poppler-tools ;;
    *:pdf) echo ghostscript poppler-utils ;;
    *:node) echo nodejs npm ;;
  esac
}
UPDATED=0
install() {  # install <part> <name shown>
  read -r -a pkgs <<<"$(packages "$1")"
  info "Installing $2 (${pkgs[*]})..."
  case $PM in
    apt) [ $UPDATED = 1 ] || { $SUDO apt-get update -qq; UPDATED=1; }
         $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${pkgs[@]}" ;;
    dnf) $SUDO dnf install -y -q "${pkgs[@]}" ;;
    pacman) $SUDO pacman -S --needed --noconfirm "${pkgs[@]}" ;;
    zypper) $SUDO zypper --non-interactive --quiet install "${pkgs[@]}" ;;
    *) false ;;
  esac || { warn "$2 could not be installed (install it with your package manager)."; return 1; }
}
python_ok() { have python3 && python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'; }

printf '\033[1;36mStudent Hub installer\033[0m\n'
info "It installs everything Student Hub uses. No questions; a log is saved in install-log.txt."

step "Python and basics"
install base "curl and git"
python_ok || install python "Python"
python_ok || { echo "Python 3.9 or newer is missing. Install it and run ./install.sh again."; exit 1; }
info "Using $(python3 --version)"

step "GitHub CLI"
if have gh; then info "Already installed."; else install gh "GitHub CLI" || info "See https://cli.github.com for other ways to install it."; fi

step "LibreOffice (Word to PDF, Office previews)"
if have soffice || have libreoffice; then info "Already installed."; else install libreoffice "LibreOffice"; fi

step "PDF tools (Ghostscript, Poppler)"
if have gs && have pdfinfo; then info "Already installed."; else install pdf "Ghostscript and Poppler"; fi

export PATH="$HOME/.local/bin:$PATH"
step "Claude Code"
if have claude; then info "Already installed."
else curl -fsSL https://claude.ai/install.sh | bash || warn "Claude Code could not be installed."; fi

step "ChatGPT Codex and Gemini CLIs (Node.js)"
have npm || install node "Node.js"
if have npm; then
  # Into ~/.local (no sudo); Student Hub finds them there.
  npm install -g --prefix "$HOME/.local" --no-fund --no-audit @openai/codex @google/gemini-cli && info "Ready." \
    || warn "Codex/Gemini could not be installed with npm."
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$node_major" -ge 20 ] || warn "Node.js $node_major is old: Gemini needs Node.js 20 or newer (Claude and Codex work)."
fi

step "Whisper (lecture subtitles on this computer)"
WHISPER="${XDG_DATA_HOME:-$HOME/.local/share}/student-hub/whisper"
if [ -x "$WHISPER/bin/python" ]; then info "Already installed."
else
  info "Installing faster-whisper. This takes a few minutes."
  python3 -m venv "$WHISPER" && "$WHISPER/bin/pip" install --disable-pip-version-check -q faster-whisper && info "Ready." \
    || warn "Whisper could not be installed."
fi

step "Start button (applications menu and desktop)"
chmod +x start.sh
entry="[Desktop Entry]
Type=Application
Name=Student Hub
Comment=Start Student Hub
Exec=\"$HUB_DIR/start.sh\"
Path=$HUB_DIR
Terminal=true
Icon=applications-education
Categories=Education;Office;"
mkdir -p "$HOME/.local/share/applications"
printf '%s\n' "$entry" > "$HOME/.local/share/applications/student-hub.desktop"
desktop=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
if [ -d "$desktop" ]; then
  printf '%s\n' "$entry" > "$desktop/student-hub.desktop"
  chmod +x "$desktop/student-hub.desktop"
  gio set "$desktop/student-hub.desktop" metadata::trusted true 2>/dev/null || true
fi
info "'Student Hub' is in your applications menu and on your desktop."

step "Setup check"
python3 server.py --check || { echo; echo "Something required is missing (marked !! above). Send install-log.txt if you need help."; exit 1; }

echo
if [ ${#MISSING[@]} -gt 0 ]; then
  printf '\033[33mInstalled, except:\033[0m\n'; printf '  - %s\n' "${MISSING[@]}"
fi
printf '\033[32mStudent Hub is installed.\033[0m\n'

if [ -z "${CI:-}" ] && [ -t 0 ]; then
  if have claude; then
    echo "Sign in to Claude once (follow the link, then type /exit):"
    claude </dev/tty || true
  fi
  echo "Starting Student Hub..."
  exec ./start.sh
fi
