# Pathwise — Local Setup & Execution

## Prerequisites

- **Docker Desktop** (runs Postgres 16 + pgvector, Redis, and the API)
- **Node.js 20+** and npm (frontend)
- **Python 3.12** — only if you want to run the backend outside Docker
  (3.13+ lacks wheels for some pinned dependencies)
- No API keys required (but use claude/openai + youtube for better experience) — every AI provider defaults to `mock` and the app
  runs fully offline

## 1. Clone

```bash
git clone https://github.com/abhishekrajdhar/hcl-hackathon.git
cd hcl-hackathon
```

## 2. Backend — one command (Docker)

```bash
docker compose up -d
```

This builds the API image, waits for Postgres, runs `alembic upgrade head`,
seeds the skill graph, the real-course catalogue, the bootstrap admin and the
demo learner (all idempotent), then serves on <http://localhost:8000>.

- API docs: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>

If ports 5432 / 6379 / 8000 are taken: copy `.env.example` → `.env` at the
repo root and change `POSTGRES_PORT`, `REDIS_PORT` or `API_PORT` (only the
host-side mappings change; container-internal ports stay fixed).

## 3. Frontend

```bash
cd frontend && npm install
BACKEND_URL=http://localhost:8000 npm run dev
```

Opens on <http://localhost:3000>. Next.js rewrites `/api/*` to the backend
server-side, so the browser stays same-origin and no CORS setup is needed.

## 4. Use it

- **Instant demo (no account):** <http://localhost:3000/dashboard?demo=1> —
  signs into the seeded demo learner (`demo@example.com` / `demo-universe`),
  a real account served live by the engine.
- **Your own journey:** Sign up → onboarding → describe a goal in one
  sentence — *"I want to become a machine learning engineer, I have 8 hours a
  week and I already know Python"* — and the roadmap and 3D universe generate
  from it.

## 5. Optional — real AI providers

Copy the template and add any keys you have to `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

| Setting | Effect |
|---|---|
| `LLM_PROVIDER=claude` + `ANTHROPIC_API_KEY` | Real coach replies, "Why this?" explanations, role-graph design for unknown goals |
| `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY` | Real semantic search (re-embed after switching: `docker compose exec api python -m app.db.seed`) |
| `CATALOGUE_PROVIDER=youtube` + `YOUTUBE_API_KEY` | Course discovery + provable dead-link health checks (`scrape` works keyless; `none` stays offline) |

Env-file changes need a container **recreate** (a plain restart doesn't
reload `env_file`):

```bash
docker compose up -d --force-recreate api
```

Without keys, everything still works: providers degrade to `mock`, and the
coach answers from stored catalogue facts instead of a model.

## 6. Run the tests

```bash
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

**415 tests.** Engine tests need no database (everything in `app/engines/` is
pure); API tests run against the Docker Postgres and skip themselves if it is
unreachable.

## 7. Shut down

```bash
docker compose down        # keeps data (named volumes)
docker compose down -v     # full reset, wipes the database
```

## Alternative: backend without Docker

```bash
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
docker compose up -d postgres redis
.venv/bin/alembic upgrade head && .venv/bin/python -m app.db.seed
.venv/bin/uvicorn app.main:app --reload
```

For real local embeddings without OpenAI, install the optional extra (pulls
torch) and set `EMBEDDING_PROVIDER=sentence_transformer`:

```bash
.venv/bin/pip install -r requirements-embeddings.txt
```

---

