# Open-Time

Team time tracking app for RepoScout, built to be extractable as a SaaS
product later. Next.js (App Router, TypeScript) + SQLite via better-sqlite3.

## Orchestrator workflow

This repo uses a plan/execute split to keep frontier-model usage on judgment,
not keystrokes:

- **Orchestrator (frontier model, e.g. Fable/Opus)**: reads the codebase,
  writes/updates `docs/PLAN.md`, breaks work into tasks, reviews the merged
  result, commits.
- **`executor` agent (Sonnet)**: implements one scoped task at a time.
  Never commits.
- **`prompt-tuner` agent (Sonnet)**: optional cheap pass that turns a rough
  task idea into a tight executor brief before an expensive run.

Rules of engagement:
- All architectural decisions and the API contract live in `docs/PLAN.md`.
  Executors follow it; they do not redesign it.
- Run executors sequentially unless their file scopes are provably disjoint.
- The orchestrator reviews every executor result (diff + build/test output)
  before committing.

## Commands

- `npm run dev` — dev server on :3000
- `npm run build` — production build (must pass before any commit)
- `npm test` — API/unit tests (vitest)
- `npm run seed` — reset and seed the local SQLite DB

## Conventions

- Database file lives at `data/opentime.db` (gitignored); schema is applied
  idempotently on startup from `src/lib/db.ts`.
- API routes under `src/app/api/**` return JSON `{ data }` on success and
  `{ error: string }` with a proper status code on failure.
- Times are stored as ISO-8601 UTC strings; durations derived, never stored
  redundantly except where the plan says so.
- No auth in the MVP (trusted-team mode); keep user identity as an explicit
  `userId` parameter everywhere so auth can be layered in later.
