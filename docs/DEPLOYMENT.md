# Deploying Pathwise — Supabase + Render (free tier)

Both halves run on **free plans**: a Supabase free-tier Postgres and two Render
free web services. The topology:

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
Render Blueprint defining the API and the frontend, both on `plan: free`.

**What free costs you** (worth knowing before a demo):

- Free services **spin down after ~15 minutes idle**; the next request takes up
  to a minute while the instance wakes and the entrypoint re-runs its
  (idempotent) migrate + seed. **Open both URLs a few minutes before
  presenting** so everything is warm.
- The workspace gets **750 free instance-hours/month** — plenty, because
  sleeping services don't consume hours.
- **Cron jobs have no free tier**, so the catalogue maintenance jobs are run
  manually from your machine instead (see the catalogue section below).
- 512 MB RAM per service — the API serves with a single uvicorn worker (the
  Dockerfile default), which fits comfortably.

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
   creates `pathwise-api` (Docker) and `pathwise-frontend` (Node), both free.
   When prompted for the `sync: false` values:
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

### Catalogue maintenance (manual on the free tier)

Render cron jobs aren't free, and the catalogue jobs don't need to live in the
cloud — the pipeline runs from your machine against the production database.
From `backend/`, with your local `.venv`:

```bash
# nightly-ish — deactivate videos that vanished upstream (~2–3 quota units total)
DATABASE_URL="<the Supabase DSN>" .venv/bin/python -m scripts.catalogue_pipeline health

# weekly-ish — find real courses for skills nothing teaches (plan first, then spend)
DATABASE_URL="<the Supabase DSN>" .venv/bin/python -m scripts.catalogue_pipeline gaps --dry-run
DATABASE_URL="<the Supabase DSN>" .venv/bin/python -m scripts.catalogue_pipeline gaps --yes
```

Your local `backend/.env` already carries the provider keys; `DATABASE_URL`
overrides only the database target. If you later move to a paid plan, the two
cron definitions from this repo's git history restore the scheduled versions.

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
- [ ] Free-tier demo: both URLs opened and warm before presenting
- [ ] Demo learner: keep (public demo) or disable (`DEMO_LEARNER_EMAIL=`)
