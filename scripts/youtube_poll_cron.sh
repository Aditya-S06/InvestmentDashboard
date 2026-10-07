#!/usr/bin/env bash
# Nightly YouTube poll — schedule via cron, e.g.:
#   0 6 * * * /path/to/project_oracle_v.5/scripts/youtube_poll_cron.sh >> /var/log/youtube-poll.log 2>&1
set -euo pipefail
# Explicit runtime + YouTube settings only (same names as the Node boundary).
child_env=(PYTHON_DOTENV_DISABLED=1)
utility_env=()
for name in \
  PATH SystemRoot WINDIR COMSPEC \
  HOME USERPROFILE HOMEDRIVE HOMEPATH APPDATA LOCALAPPDATA \
  XDG_CACHE_HOME XDG_CONFIG_HOME TMPDIR TMP TEMP \
  LANG LC_ALL LC_CTYPE TZ PYTHONIOENCODING PYTHONUTF8 PYTHONUNBUFFERED \
  SSL_CERT_FILE SSL_CERT_DIR REQUESTS_CA_BUNDLE CURL_CA_BUNDLE \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  YOUTUBE_API_KEY OPENROUTER_API_KEY YOUTUBE_CACHE_DIR YOUTUBE_CHANNELS_FILE \
  YOUTUBE_POLL_SINCE_DAYS YOUTUBE_RATE_LIMIT_PER_MIN YOUTUBE_SUMMARY_MODEL; do
  if [[ ${!name+x} ]]; then
    child_env+=("$name=${!name}")
    case "$name" in
      PATH|SystemRoot|WINDIR|LANG|LC_ALL|LC_CTYPE) utility_env+=("$name=${!name}") ;;
    esac
  fi
done
ROOT="$(cd "$(env -i "${utility_env[@]}" dirname "$0")/.." && pwd)"
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
    env -i "${utility_env[@]}" mkdir -p conf
    env -i "${utility_env[@]}" cp conf/youtube_channels.json.example conf/youtube_channels.json
    CHANNELS_FILE="conf/youtube_channels.json"
  else
    echo "No channels file at $CHANNELS_FILE" >&2
    exit 1
  fi
fi

exec env -i "${child_env[@]}" "$PY" scripts/youtube_ingest.py poll "$CHANNELS_FILE"
