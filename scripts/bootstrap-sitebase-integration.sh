#!/usr/bin/env bash
# Bootstrap AiHub for sitebase local integration (DB in Docker, API on host).
# Usage: cd aihubproject && ./scripts/bootstrap-sitebase-integration.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

"${ROOT}/scripts/ensure-dev-ready.sh"

set -a
# shellcheck disable=SC1091
source .env
set +a

# Host API talks to published MySQL port
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-3307}"

OUT_DIR="$ROOT/.local-integration"
mkdir -p "$OUT_DIR"
PID_FILE="$OUT_DIR/api.pid"
LOG_FILE="$OUT_DIR/api.log"
SITEBASE_ENV_SNIPPET="$OUT_DIR/sitebase-ai-hub.env"
CREDS_FILE="$OUT_DIR/hub-project-key.txt"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "==> API already running (pid $(cat "$PID_FILE"))"
else
  echo "==> Starting API on :3400..."
  nohup npm run dev >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
fi

echo "==> Waiting for /health..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3400/health >/dev/null 2>&1; then
    echo "    hub is up"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "Hub did not become healthy. Tail: $LOG_FILE"
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi
  sleep 1
done

echo "==> Ensuring sitebase project exists..."
CREATE_RESP=$(curl -sS -X POST http://127.0.0.1:3400/admin/projects \
  -H "Authorization: Bearer ${ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"projectKey":"sitebase","projectName":"Sitebase","allowedFeatures":null}' || true)

if echo "$CREATE_RESP" | grep -q '"apiKey"'; then
  API_KEY=$(echo "$CREATE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["apiKey"])')
  umask 077
  printf '%s\n' "$API_KEY" >"$CREDS_FILE"
  echo "    created project; api key saved to $CREDS_FILE"
elif [[ -f "$CREDS_FILE" ]]; then
  API_KEY=$(tr -d '\n' <"$CREDS_FILE")
  echo "    reusing existing key from $CREDS_FILE"
else
  echo "    create failed and no saved key. Response: $CREATE_RESP"
  echo "    Rotate: curl -s -X POST http://127.0.0.1:3400/admin/projects/sitebase/rotate -H \"Authorization: Bearer \$ADMIN_SECRET\""
  ROTATE_RESP=$(curl -sS -X POST http://127.0.0.1:3400/admin/projects/sitebase/rotate \
    -H "Authorization: Bearer ${ADMIN_SECRET}" \
    -H "Content-Type: application/json" || true)
  if echo "$ROTATE_RESP" | grep -q '"apiKey"'; then
    API_KEY=$(echo "$ROTATE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["apiKey"])')
    umask 077
    printf '%s\n' "$API_KEY" >"$CREDS_FILE"
    echo "    rotated; api key saved to $CREDS_FILE"
  else
    echo "    rotate failed: $ROTATE_RESP"
    exit 1
  fi
fi

umask 077
cat >"$SITEBASE_ENV_SNIPPET" <<EOF
# Paste into sitebase/backend/.env.development
AI_HUB_URL=http://127.0.0.1:3400
AI_HUB_API_KEY=${API_KEY}
AI_HUB_ADMIN_SECRET=${ADMIN_SECRET}
EOF

echo "==> Hub smoke..."
curl -sf http://127.0.0.1:3400/health
echo
curl -sf http://127.0.0.1:3400/v1/health -H "Authorization: Bearer ${API_KEY}" || true
echo

echo "==> Done."
echo "Merge $SITEBASE_ENV_SNIPPET into sitebase/backend/.env.development"
echo "Then in AiManagement: save https provider + mapping (text_default, carousel_image, text, image)"
