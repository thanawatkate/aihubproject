# Sitebase ↔ AiHub local integration

## Current local state (after bootstrap)

| Component | How |
|-----------|-----|
| Hub MySQL | `docker compose up -d db` → `localhost:3307` |
| Hub API | `npm run dev` in `aihubproject` → `http://127.0.0.1:3400` |
| Sitebase | set `AI_HUB_*` in `sitebase/backend/.env.development` |

## One-shot bootstrap

```bash
cd aihubproject
# ensure .env exists (ADMIN_SECRET >=32, ENCRYPTION_KEY=64 hex)
./scripts/bootstrap-sitebase-integration.sh
```

This starts MySQL, migrates, starts the API, creates project `sitebase`, and writes:

- `.local-integration/sitebase-ai-hub.env` (paste into sitebase)
- `.local-integration/hub-project-key.txt`

## Wire sitebase

```bash
# merge into sitebase/backend/.env.development
cat aihubproject/.local-integration/sitebase-ai-hub.env
```

Required:

```env
AI_HUB_URL=http://127.0.0.1:3400
AI_HUB_API_KEY=hub_live_...
AI_HUB_ADMIN_SECRET=...   # same as aihub ADMIN_SECRET
```

Restart sitebase backend after changing env.

## Configure provider (required for generate)

Hub rejects `http://` and private/localhost `baseUrl`. Use a real HTTPS provider, e.g. OpenAI:

1. Open Site Settings → AI Management (or call hub admin API)
2. Save provider with `https://api.openai.com/v1` + API key
3. Set usage mapping:
   - `text` / `text_default` → text
   - `image` / `carousel_image` → image
4. Click Test connection

## Smoke checklist

```bash
# Hub liveness
curl -s http://127.0.0.1:3400/health

# Hub authenticated health (project key)
curl -s http://127.0.0.1:3400/v1/health -H "Authorization: Bearer $AI_HUB_API_KEY"

# Sitebase proxy (JWT of a user with ai_provider_settings.manage)
curl -s "$SITEBASE/v1/ai/health" -H "Authorization: Bearer $JWT"
curl -s "$SITEBASE/v1/ai/settings" -H "Authorization: Bearer $JWT"
```

UI: AI Management should show **AI Hub** chip and live health (not `AI_HUB_NOT_CONFIGURED`).

## Notes

- Seed no longer maps to a missing `openai_main` provider.
- Migrate bug fixed: SQL comment headers no longer skip `CREATE TABLE`.
- Docker `api` profile is optional (`--profile containerized`); default local path is DB-in-Docker + API-on-host.
