#!/usr/bin/env bash
# Bootstrap AiHub for ThaiSnapAI local integration (DB in Docker, API on host).
# Usage: cd aihubproject && ./scripts/bootstrap-thaisnapai-integration.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

"${ROOT}/scripts/ensure-dev-ready.sh"

set -a
# shellcheck disable=SC1091
source .env
set +a

export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-3307}"

OUT_DIR="$ROOT/.local-integration"
mkdir -p "$OUT_DIR"
PID_FILE="$OUT_DIR/api.pid"
LOG_FILE="$OUT_DIR/api.log"
THAISNAP_ENV_SNIPPET="$OUT_DIR/thaisnapai-ai-hub.env"
CREDS_FILE="$OUT_DIR/thaisnapai-hub-project-key.txt"
THAISNAP_ENV="$(cd "$ROOT/.." && pwd)/ThaiSnapAI/.env"

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

echo "==> Ensuring thaisnapai project exists..."
CREATE_RESP=$(curl -sS -X POST http://127.0.0.1:3400/admin/projects \
  -H "Authorization: Bearer ${ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"projectKey":"thaisnapai","projectName":"ThaiSnapAI","allowedFeatures":null}' || true)

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
  echo "    Rotate: curl -s -X POST http://127.0.0.1:3400/admin/projects/thaisnapai/rotate -H \"Authorization: Bearer \$ADMIN_SECRET\""
  ROTATE_RESP=$(curl -sS -X POST http://127.0.0.1:3400/admin/projects/thaisnapai/rotate \
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
cat >"$THAISNAP_ENV_SNIPPET" <<EOF
# Merge into ThaiSnapAI/.env
AI_HUB_URL=http://127.0.0.1:3400
AI_HUB_API_KEY=${API_KEY}
AI_HUB_ADMIN_SECRET=${ADMIN_SECRET}
EOF

merge_thaisnap_env() {
  local key="$1" val="$2" file="$3"
  python3 - "$key" "$val" "$file" <<'PY'
import sys
key, val, path = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except FileNotFoundError:
    raise SystemExit(2)
found = False
out = []
for line in lines:
    if line.startswith(key + "="):
        current = line.split("=", 1)[1]
        if current.strip():
            out.append(line)
        else:
            out.append(f"{key}={val}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={val}")
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
}

if [[ -f "$THAISNAP_ENV" ]]; then
  echo "==> Filling empty AI_HUB_* in ${THAISNAP_ENV}"
  merge_thaisnap_env AI_HUB_URL "http://127.0.0.1:3400" "$THAISNAP_ENV" || true
  merge_thaisnap_env AI_HUB_API_KEY "$API_KEY" "$THAISNAP_ENV" || true
  merge_thaisnap_env AI_HUB_ADMIN_SECRET "$ADMIN_SECRET" "$THAISNAP_ENV" || true
fi

echo "==> Hub smoke..."
curl -sf http://127.0.0.1:3400/health
echo
curl -sf http://127.0.0.1:3400/v1/health -H "Authorization: Bearer ${API_KEY}" || true
echo

echo "==> Done."
echo "Merge $THAISNAP_ENV_SNIPPET into ThaiSnapAI/.env if AI_HUB_* are still empty"
echo "Then in Settings → AI Hub: add an HTTPS provider + map script / producer"
