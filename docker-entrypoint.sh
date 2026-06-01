#!/bin/sh
# docker-entrypoint.sh
# Runs as the app user at container start, before the Node server.
set -e

# ── Settings file: keep API keys on the persisted volume ─────────────────────
# /app/data is a bind-mount or named volume, so settings survive container restarts.
# The Node app looks for settings.local.json relative to CWD (/app).
if [ ! -f /app/settings.local.json ]; then
  if [ -f /app/data/settings.local.json ]; then
    ln -sf /app/data/settings.local.json /app/settings.local.json
  fi
fi

# If we have a settings.local.json in /app/data, always link it
ln -sf /app/data/settings.local.json /app/settings.local.json 2>/dev/null || true

exec "$@"
