# aihubproject

Central multi-tenant AI Hub: text/image generation, provider config, quotas, and billing.

This service is **product-agnostic**. Consumers (e.g. sitebase, other apps) pass their own
`usageKey` / `feature` labels. Hub defaults are generic (`text`, `image`).

## Requirements

- Node.js 18+
- MySQL 8

## Quick start (development)

```bash
# First run: creates .env, starts MySQL (docker), npm install, migrate
./scripts/ensure-dev-ready.sh
npm run dev
```

Or copy `.env.example` yourself and set `DB_*`, `ADMIN_SECRET` (>=32 chars), `ENCRYPTION_KEY` (64 hex chars), then `npm install && npm run migrate && npm run dev`.

Docker:

```bash
export ADMIN_SECRET='your-long-admin-secret-min-32-chars'
export ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
docker compose up --build
```

API listens on `http://localhost:3400` by default.

## Production

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

See `docker-compose.prod.yml` and set strong `ADMIN_SECRET` / `ENCRYPTION_KEY`.

## Auth

| Audience | Header | Used for |
|----------|--------|----------|
| Project | `Authorization: Bearer <project_api_key>` | `/v1/*` |
| Admin | `Authorization: Bearer <ADMIN_SECRET>` | `/admin/*` |

Create a project key via `POST /admin/projects` (admin). Save the raw key once.

## Core APIs

| Method | Path | Notes |
|--------|------|-------|
| POST | `/v1/text/assist` | Body: action, content, prompt, language, `usageKey` (default `text`), `feature` |
| POST | `/v1/text/generate` | Product-agnostic. Body: `prompt` (1..60000), `system?` (max 8000), `language`, `usageKey` (default `text`), `feature` (default `text_generate`), `userId?`, `maxOutputTokens?` (int 1..16384). Over-limit = 400, never truncated. Same response shape as assist |
| POST | `/v1/image/generate` | Body: prompt, size, `usageKey` (default `image`), optional targetWidth/Height, `feature` |
| GET | `/v1/usage/summary` | Project usage |
| GET | `/v1/usage/logs` | Project ledger |
| GET | `/health` | Liveness (no auth) |
| GET | `/v1/health` | Provider readiness (auth required) |
| * | `/admin/providers*` | Provider CRUD + usage mapping |
| * | `/admin/projects*` | Multi-project keys |
| * | `/admin/billing/*`, `/admin/model-pricing` | Global package + pricing |
| GET | `/admin/audit/logs` | Admin audit trail (paginated) |
| POST | `/admin/audit/purge` | Delete audit rows older than N days |

Usage mapping keys are free-form strings. Seed includes only generic `text` and `image`.
Consumers may register their own keys (e.g. `carousel_image`, `chat_reply`) via admin API.

## Consumer example (sitebase)

```env
AI_HUB_URL=https://aihub.example.com
AI_HUB_API_KEY=<project api key>
AI_HUB_ADMIN_SECRET=<same as ADMIN_SECRET>
```

Sitebase is hub-only for AI and passes product-specific `usageKey` / `feature` values.
Without these env vars, sitebase returns `AI_HUB_NOT_CONFIGURED` (503).

## Security notes

- Admin auth must reject and **stop** unauthenticated requests (`return reply.code(401)...`)
- Project auth uses the same halt pattern
- Optional `ADMIN_IP_ALLOWLIST` for admin routes
- Project `allowedFeatures` is enforced on `/v1` generate routes (`null` = all)
- Global rate limit + stricter generate-route limit (`RATE_LIMIT_GENERATE_MAX`)
- Per-project concurrency via DB leases (`ai_inflight_leases`, replica-safe, TTL expiry)
- Monthly request/token/cost quotas use atomic DB reservation holds sized from request shape + safety mult
- Admin mutations write to `ai_admin_audit_log` (no secrets in meta)
- `GET /admin/audit/logs` + `POST /admin/audit/purge`; optional `ADMIN_AUDIT_AUTO_PURGE`
- `REQUEST_TIMEOUT_MS` caps whole-request lifetime
- Outbound provider URLs must be `https` and must not resolve to private/reserved IPs
- Production refuses weak/default `ENCRYPTION_KEY` and placeholder `ADMIN_SECRET`
- Container runs as non-root user `aihub`
- Run migrations after pull (`003`/`004` + migrate.ts column ensure)

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Watch mode |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run production build |
| `./scripts/ensure-dev-ready.sh` | Create `.env` if missing, start Docker MySQL, migrate |
| `./scripts/bootstrap-thaisnapai-integration.sh` | Dev ready + project `thaisnapai` + env snippet |
| `npm run migrate` | Apply SQL migrations |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
