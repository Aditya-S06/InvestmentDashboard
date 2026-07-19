#!/usr/bin/env bash
# Nightly YouTube poll — schedule via cron, e.g.:
#   0 6 * * * /path/to/project_oracle_v.5/scripts/youtube_poll_cron.sh >> /var/log/youtube-poll.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .venv/bin/python ]]; then
  PY=".venv/bin/python"
elif [[ -f .venv/Scripts/python.exe ]]; then
  PY=".venv/Scripts/python.exe"
else
  PY="python3"
fi

CHANNELS_FILE="${YOUTUBE_CHANNELS_FILE:-conf/youtube_channels.json}"
if [[ ! -f "$CHANNELS_FILE" ]]; then
  if [[ -f conf/youtube_channels.json.example ]]; then
    mkdir -p conf
    cp conf/youtube_channels.json.example conf/youtube_channels.json
    CHANNELS_FILE="conf/youtube_channels.json"
  else
    echo "No channels file at $CHANNELS_FILE" >&2
    exit 1
  fi
fi

exec "$PY" scripts/youtube_ingest.py poll "$CHANNELS_FILE"
