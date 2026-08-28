# Deploying Pathwise — Supabase + Render

The production topology this guide targets:

```
Browser ──▶ pathwise-frontend (Render, Node/Next.js)
                 │  server-side rewrite of /api/* — the browser stays same-origin
                 ▼
            pathwise-api (Render, Docker/FastAPI)
                 │
                 ▼
            Supabase Postgres (pgvector) ·· optional Redis (cache degrades to memory)
```

Everything is driven by [`render.yaml`](../render.yaml) at the repo root — a
Render Blueprint defining the API, the frontend, and two optional catalogue
cron jobs.

---

## 1. Supabase (the database)

1. Create a project at <https://supabase.com/dashboard>. Choose a strong
   database password **without characters that need URL-escaping** (or escape
   them later).
2. No manual SQL is needed: the **first Alembic migration creates the
   extensions itself** (`vector`, `pgcrypto`, `pg_trgm` — all on Supabase's
   allow-list), and the API runs migrations on boot.
3. Get the connection string: **Project Settings → Database → Connection
   string**, and pick the **Session pooler** (shared pooler, port **5432**).
   Two things matter here:
   - **Session pooler, not transaction pooler.** The transaction pooler
     (port 6543) multiplexes statements and breaks asyncpg's prepared
     statements. Session mode behaves like a direct connection.
   - **The pooler is IPv4.** Supabase's *direct* connection is IPv6-only on
     most plans, and Render egress is IPv4 — the pooler is the compatible
     path.
4. Convert it to the async DSN the app uses — scheme `postgresql+asyncpg`,
   SSL required:

   ```
   postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?ssl=require
   ```

   That single `DATABASE_URL` is all the app needs — migrations, seeding and
   the entrypoint's readiness wait all derive from it.

## 2. Render (API + frontend)

1. Push the repo to GitHub/GitLab and open <https://dashboard.render.com>.
2. **Create the secrets group first**: Env Groups → *New Environment Group* →
   name it exactly `pathwise-secrets`, holding:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase DSN from step 1.4 |
   | `SECRET_KEY` | `openssl rand -hex 32` — the API **refuses to boot** in production on the dev default |
   | `ANTHROPIC_API_KEY` | Claude for coach/explanations/role design (see provider note below) |
   | `OPENAI_API_KEY` | real semantic embeddings |
   | `YOUTUBE_API_KEY` | catalogue discovery + provable health checks |
   | `FIRST_ADMIN_EMAIL` / `FIRST_ADMIN_PASSWORD` | bootstrap admin account |

3. **New → Blueprint**, point it at the repo. Render reads `render.yaml` and
   creates `pathwise-api` (Docker), `pathwise-frontend` (Node) and the two
   cron jobs. When prompted for the `sync: false` values:
   - `CORS_ORIGINS` → your frontend URL (e.g. `https://pathwise-frontend.onrender.com`)
   - `BACKEND_URL` → your API URL (e.g. `https://pathwise-api.onrender.com`) —
     if you don't know the final names yet, put placeholders and fix them
     after the first deploy; the frontend needs a redeploy after changing it.
4. First API deploy: the entrypoint waits for Supabase, runs
   `alembic upgrade head`, seeds the graph/catalogue/admin/demo learner
   (idempotent — safe on every deploy), then serves. Health gate is
   `/health/ready`, which checks the database.
5. Open the frontend URL. `/dashboard?demo=1` should land in the live demo
   universe; `/health` on the API should report your providers.

### Provider notes

- `LLM_PROVIDER=claude` and `EMBEDDING_PROVIDER=openai` are set in the
  blueprint. Prefer OpenAI for both halves? Change `LLM_PROVIDER` to `openai`.
  (If the OpenAI key is missing but an Anthropic key exists, the API
  substitutes Claude automatically and `/health` reports the provider actually
  answering.)
- **Changing the embedding provider changes what the vectors mean** — after a
  switch, re-embed: `POST /api/v1/resources/embed-all` as the admin.
- No keys at all still boots: every provider degrades to `mock`, and catalogue
  ingestion to `none`.

### Optional: Redis cache

The shared query-embedding cache defaults to in-memory and degrades
gracefully, so Redis is optional. To add it: create a **Render Key Value**
instance, then set on `pathwise-api`:
`EMBEDDING_CACHE_BACKEND=redis` and `REDIS_URL=<internal connection string>`.

### The cron jobs

- `pathwise-catalogue-health` (nightly 02:30 UTC) — re-checks every catalogue
  video against YouTube (~2–3 quota units for the whole catalogue) and
  deactivates ones that are gone. Only the YouTube provider may deactivate —
  it can *prove* absence.
- `pathwise-catalogue-gaps` (weekly Mon 03:00 UTC) — finds real courses for
  skills nothing teaches (~100 quota units per searched skill), with the LLM
  judging an engine-vetted shortlist.

Both reuse the API image with `RUN_SEED=false`; delete them from the
blueprint if you don't want scheduled jobs.

### Demo learner

The seed creates the shared demo account (`demo@example.com` /
`demo-universe`) that powers `/dashboard?demo=1` and the landing-page galaxy —
keep it for a public demo. To disable it, set `DEMO_LEARNER_EMAIL` to empty on
`pathwise-api`.

---

## Alternative: single VPS with Docker Compose

For a box you own, the production overlay removes dev bind-mounts/`--reload`,
stops publishing Postgres/Redis ports, and serves uvicorn with workers behind
whatever TLS proxy (Caddy/nginx) you put in front of `:8000`:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Set `SECRET_KEY`, `ENVIRONMENT=production` and your provider keys in
`backend/.env`; run the frontend with `npm run build && npm run start` (or a
third container) with `BACKEND_URL` pointing at the API.

---

## Production checklist

- [ ] `SECRET_KEY` set (the API hard-refuses the dev default in production)
- [ ] `DATABASE_URL` uses the **session pooler**, `+asyncpg`, `?ssl=require`
- [ ] `ENVIRONMENT=production`, `LOG_FORMAT=json`, `DEBUG=false` (blueprint sets these)
- [ ] `FIRST_ADMIN_*` set; sign in once and verify `/health` providers
- [ ] `CORS_ORIGINS` = frontend origin; `BACKEND_URL` = API origin
- [ ] Embeddings re-run after any embedding-provider change
- [ ] Supabase automated backups are on (Settings → Database → Backups)
- [ ] Demo learner: keep (public demo) or disable (`DEMO_LEARNER_EMAIL=`)
