#!/usr/bin/env bash
# Student Hub installer for Linux. Run it once from the Student Hub folder, before you sign in:
#   ./install-linux.sh          asks before each optional part
#   ./install-linux.sh --yes    installs the recommended parts without asking
# It installs what the app uses (with your package manager and sudo), lets you sign in to an AI CLI and GitHub,
# adds a "Student Hub" launcher to your applications menu, and finishes with the setup check.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
HUB_DIR=$PWD
YES=0
[ "${1:-}" = "--yes" ] && YES=1

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
ask() {  # ask "Question" Y|N
  local answer
  if [ "$YES" = 1 ]; then [ "$2" = Y ]; return; fi
  if [ "$2" = Y ]; then read -r -p "$1 [Y/n] " answer </dev/tty || answer=""; answer=${answer:-y}
  else read -r -p "$1 [y/N] " answer </dev/tty || answer=""; answer=${answer:-n}; fi
  [[ $answer =~ ^[Yy] ]]
}

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO=sudo
if have apt-get; then PM=apt
elif have dnf; then PM=dnf
elif have pacman; then PM=pacman
elif have zypper; then PM=zypper
else PM=none; fi

# Package names per package manager for each part.
packages() {
  case "$PM:$1" in
    apt:python) echo python3 python3-venv python3-pip ;;
    dnf:python|zypper:python) echo python3 python3-pip ;;
    pacman:python) echo python python-pip ;;
    *:base) echo curl ca-certificates ;;
    pacman:gh) echo github-cli ;;
    *:gh) echo gh ;;
    *:git) echo git ;;
    pacman:libreoffice) echo libreoffice-fresh ;;
    *:libreoffice) echo libreoffice-writer libreoffice-calc libreoffice-impress ;;
    *:ghostscript) echo ghostscript ;;
    apt:poppler|dnf:poppler) echo poppler-utils ;;
    pacman:poppler) echo poppler ;;
    zypper:poppler) echo poppler-tools ;;
    *:node) echo nodejs npm ;;
  esac
}

UPDATED=0
install_part() {  # install_part python git ...
  local pkgs=()
  for part in "$@"; do read -r -a more <<<"$(packages "$part")"; pkgs+=("${more[@]}"); done
  [ ${#pkgs[@]} -eq 0 ] && return 0
  echo "Installing: ${pkgs[*]}"
  case $PM in
    apt) if [ $UPDATED = 0 ]; then $SUDO apt-get update; UPDATED=1; fi
         $SUDO apt-get install -y "${pkgs[@]}" ;;
    dnf) $SUDO dnf install -y "${pkgs[@]}" ;;
    pacman) $SUDO pacman -S --needed --noconfirm "${pkgs[@]}" ;;
    zypper) $SUDO zypper --non-interactive install "${pkgs[@]}" ;;
    none) echo "No supported package manager (apt, dnf, pacman, zypper). Install these yourself: ${pkgs[*]}"; return 1 ;;
  esac
}

python_ok() { have python3 && python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'; }

say "Student Hub installer ($PM)"

# 1. Python (required) and the basics.
if ! python_ok; then
  say "Python 3.9 or newer is required."
  install_part python base || true
  python_ok || { echo "Python 3.9+ is still missing. Install it, then run this again."; exit 1; }
else
  have curl || install_part base || true
fi
echo "Python: $(python3 --version)"

# 2. Projects: git and the GitHub CLI.
if ! { have git && have gh; } && ask "Projects need git and the GitHub CLI. Install them?" Y; then
  install_part git gh || echo "Could not install gh from your distribution; see https://cli.github.com for other ways."
fi

# 3. Documents and PDFs.
if ! { have soffice || have libreoffice; } && ask "LibreOffice converts Word to PDF and previews Office files (about 300 MB). Install it?" Y; then
  install_part libreoffice || true
fi
if ! { have gs && have pdfinfo; } && ask "Ghostscript and Poppler compress, merge and split PDFs. Install them?" Y; then
  install_part ghostscript poppler || true
fi

# 4. An AI CLI for the assistant, the AI tools and the lecture summaries.
export PATH="$HOME/.local/bin:$PATH"
npm_cli() {  # npm_cli package command
  have npm || install_part node || return 1
  npm install -g --prefix "$HOME/.local" "$1"   # into ~/.local/bin: no sudo, and Student Hub finds it there
}
if ! { have claude || have codex || have gemini; }; then
  say "AI CLI (the assistant and AI tools use your own account through it)"
  echo "  1) Claude Code   2) ChatGPT Codex   3) Gemini   4) skip"
  choice=1
  [ "$YES" = 1 ] || read -r -p "Choose [1]: " choice </dev/tty || true
  case "${choice:-1}" in
    1) curl -fsSL https://claude.ai/install.sh | bash && AI=claude ;;
    2) npm_cli @openai/codex && AI=codex ;;
    3) npm_cli @google/gemini-cli && AI=gemini ;;
    *) AI="" ;;
  esac
  if [ -n "${AI:-}" ] && have "$AI" && [ "$YES" = 0 ] && ask "Sign in to $AI now? (Type /exit when you're done.)" Y; then
    if [ "$AI" = codex ]; then codex login </dev/tty || true; else "$AI" </dev/tty || true; fi
  fi
fi
if have gh && ! gh auth status >/dev/null 2>&1 && [ "$YES" = 0 ] && ask "Sign in to GitHub for Projects now?" Y; then
  gh auth login </dev/tty || true
fi

# 5. Whisper for lecture subtitles on this computer (optional; a free Groq key also works).
WHISPER="${XDG_DATA_HOME:-$HOME/.local/share}/student-hub/whisper"
if [ ! -x "$WHISPER/bin/python" ] && ask "Install Whisper for lecture subtitles on this computer (about 1 GB with the model)?" N; then
  python3 -m venv "$WHISPER" && "$WHISPER/bin/pip" install faster-whisper || echo "Whisper could not be installed."
fi

# 6. A launcher in the applications menu.
cat > start-linux.sh <<'EOF'
#!/usr/bin/env bash
# Starts Student Hub and opens it in the browser. Keep this window open while you use the app.
cd "$(dirname "$(readlink -f "$0")")"
(sleep 2; xdg-open http://127.0.0.1:8765 >/dev/null 2>&1 || true) &
exec python3 server.py
EOF
chmod +x start-linux.sh
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/student-hub.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Student Hub
Comment=University mail, eClass, announcements and AI tools
Exec="$HUB_DIR/start-linux.sh"
Path=$HUB_DIR
Terminal=true
Icon=applications-education
Categories=Education;Office;
EOF
echo "Added 'Student Hub' to your applications menu (or run ./start-linux.sh)."

# 7. The setup check.
say "Setup check"
python3 server.py --check || { echo; echo "Fix the parts marked !! and run ./install-linux.sh again."; exit 1; }
