# Open-Time

Minimal team time tracking for the RepoScout team.

Open-Time deliberately skips the hierarchy most time trackers pile on
(organizations, clients, tasks, roles, approvals). A project's "client" is
just an optional label. There are no tasks — a free-text note is the only
sub-project granularity. The entire daily surface for an individual
contributor is the Timer page: pick a project, optionally type a note,
start. Two interactions, zero hierarchy. See `docs/PLAN.md` for the full
rationale and API contract.

## Quickstart

```bash
npm install
npm run seed   # creates/resets data/opentime.db with sample users, projects, entries
npm run dev    # http://localhost:3000
```

There's no login: pick a team member from the user picker in the top nav.
The MVP has no UI for creating users — see "Roadmap" below.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build (must pass before any commit) |
| `npm start` | Run the production build |
| `npm test` | Data-layer tests (Vitest) |
| `npm run seed` | Reset and re-seed the local SQLite database |

## Architecture

- **Next.js 15, App Router, TypeScript.** Four pages under `src/app`
  (`/` Timer, `/timesheet`, `/projects`, `/reports`), each a client
  component that talks to the API through the small typed client in
  `src/lib/api.ts`. Styling is plain CSS with theme variables in
  `src/app/globals.css` — no Tailwind, light/dark via
  `prefers-color-scheme`.
- **SQLite via `better-sqlite3`.** The database file lives at
  `data/opentime.db` (gitignored, created on demand). Schema is applied
  idempotently at startup in `src/lib/db.ts`; all queries live in
  `src/lib/repo.ts`.
- **API shape.** Every route under `src/app/api/**` returns
  `{ "data": ... }` on success or `{ "error": "message" }` with a 400/404/409
  status on failure. The user picker stands in for auth: every call carries
  an explicit `userId` so real authentication can be layered in later
  without changing the shape of anything. Full route-by-route contract is
  in `docs/PLAN.md`.
- **Tests.** Vitest exercises `src/lib/repo.ts` directly against a temporary
  SQLite file — no HTTP layer in the test path.

## Roadmap: SaaS-ready, not SaaS

The MVP is intentionally single-team with no auth, but the schema keeps a
multi-tenant SaaS path open rather than closing it off:

- Every API call already takes an explicit `userId` — swapping the user
  picker for real sessions/auth doesn't require touching the data layer.
- Hourly rates live on the project, not scattered across
  org/member/client levels — this is the one rate concept, and it's ready
  to be the input to an invoicing layer later.
- Auth, multi-tenancy, and invoicing are explicitly out of scope for now.
  When they're built, the goal is to add them alongside the current model,
  not restructure it — the individual-contributor simplicity of the Timer
  page must not regress.
