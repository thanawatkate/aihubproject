#!/usr/bin/env bash
# Create .env if missing, start local MySQL, npm install, run migrations.
# Usage: cd aihubproject && ./scripts/ensure-dev-ready.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found — install Node.js 18+"
  exit 1
fi

set_env() {
  local key="$1" val="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    BEGIN { found=0 }
    index($0, k "=") == 1 { print k "=" v; found=1; next }
    { print }
    END { if (!found) print k "=" v }
  ' .env >"$tmp"
  mv "$tmp" .env
}

CREATED_ENV=0
if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "Missing .env.example — cannot bootstrap AiHub env"
    exit 1
  fi
  echo "==> Creating .env from .env.example (dev defaults + generated secrets)"
  cp .env.example .env
  CREATED_ENV=1

  ADMIN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  set_env ADMIN_SECRET "$ADMIN_SECRET"
  set_env ENCRYPTION_KEY "$ENCRYPTION_KEY"
  # docker-compose.yml publishes MySQL on 3307
  set_env DB_HOST localhost
  set_env DB_PORT 3307
  set_env DB_NAME aihub_db
  set_env DB_USER aihub_user
  set_env DB_PASSWORD aihub_pass
  set_env CORS_ORIGINS "http://localhost:5173,http://localhost:3000,http://localhost:3099,http://localhost:8501,http://127.0.0.1:8501,http://127.0.0.1:8000"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${ADMIN_SECRET:-}" || ${#ADMIN_SECRET} -lt 32 ]]; then
  echo "ADMIN_SECRET must be set (>=32 chars) in .env"
  exit 1
fi
if [[ -z "${ENCRYPTION_KEY:-}" || ! "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "ENCRYPTION_KEY must be 64 hex chars in .env"
  exit 1
fi

use_compose_db=0
if [[ "${DB_HOST:-localhost}" == "localhost" || "${DB_HOST}" == "127.0.0.1" ]]; then
  if [[ "${DB_PORT:-3306}" == "3307" ]]; then
    use_compose_db=1
  fi
fi

if [[ "$use_compose_db" -eq 1 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found — needed for MySQL on ${DB_HOST}:${DB_PORT}"
    exit 1
  fi
  echo "==> Starting AiHub MySQL (host port ${DB_PORT})..."
  docker compose up -d db
  echo "==> Waiting for MySQL..."
  for i in $(seq 1 90); do
    if docker compose exec -T db \
      mysql -u"${DB_USER}" -p"${DB_PASSWORD}" -D"${DB_NAME}" -N -e "SELECT 1" >/dev/null 2>&1; then
      echo "    mysql is ready"
      break
    fi
    if [[ "$i" -eq 90 ]]; then
      echo "MySQL did not become healthy. Check: docker compose logs db"
      exit 1
    fi
    sleep 2
  done
fi

if [[ ! -d node_modules ]]; then
  echo "==> npm install..."
  npm install
fi

echo "==> Migrating..."
migrated=0
for i in $(seq 1 10); do
  if npm run migrate; then
    migrated=1
    break
  fi
  echo "    migrate retry ${i}/10..."
  sleep 3
done
if [[ "$migrated" -ne 1 ]]; then
  echo "migrate failed after retries"
  exit 1
fi

if [[ "$CREATED_ENV" -eq 1 ]]; then
  echo "==> Wrote ${ROOT}/.env (gitignored)"
fi
