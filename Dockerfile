# Student Hub in a container: the same Python, LibreOffice, Ghostscript, Poppler and AI CLI on any OS, for
# linux/amd64 and linux/arm64. See "Docker" in the README for what works differently from a normal install.
#   docker compose up -d --build        then open http://127.0.0.1:8765
FROM python:3.12-slim

# Build options: docker compose build --build-arg WITH_WHISPER=1  (or set them in docker-compose.yml)
ARG WITH_LIBREOFFICE=1
ARG WITH_WHISPER=1
# all = Claude Code, ChatGPT Codex and Gemini; or claude, or none
ARG AI_CLI=all
ARG UID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gh ghostscript poppler-utils \
    && if [ "$WITH_LIBREOFFICE" = 1 ]; then \
         apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu; fi \
    && if [ "$AI_CLI" = all ]; then apt-get install -y --no-install-recommends nodejs npm; fi \
    && rm -rf /var/lib/apt/lists/*

# Claude Code's native build (linux x64 and arm64), copied out of root's home so a volume on /home/hub can't hide it.
RUN if [ "$AI_CLI" = claude ] || [ "$AI_CLI" = all ]; then \
      curl -fsSL https://claude.ai/install.sh | bash \
      && cp -L /root/.local/bin/claude /usr/local/bin/claude && rm -rf /root/.local /root/.claude*; fi \
    && if [ "$AI_CLI" = all ]; then \
      npm install -g @openai/codex @google/gemini-cli && npm cache clean --force; fi

RUN useradd --create-home --uid "$UID" hub
ENV HOME=/home/hub \
    PYTHONUTF8=1 \
    PYTHONUNBUFFERED=1 \
    STUDENT_HUB_DOCKER=1 \
    STUDENT_HUB_LISTEN=0.0.0.0 \
    STUDENT_HUB_WHISPER=/opt/whisper/bin/python \
    PATH=/home/hub/.local/bin:$PATH

# Whisper for lecture subtitles; the model (about 480 MB) is downloaded on first use into the home volume.
RUN if [ "$WITH_WHISPER" = 1 ]; then python -m venv /opt/whisper && /opt/whisper/bin/pip install --no-cache-dir faster-whisper; fi

WORKDIR /app
COPY --chown=hub *.py ./
COPY --chown=hub static ./static
USER hub
RUN mkdir -p /home/hub/Projects

EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request as u; u.urlopen(u.Request('http://127.0.0.1:8765/', headers={'Host': '127.0.0.1:8765'}), timeout=4)"
CMD ["python", "server.py"]
