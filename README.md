# Open-Time

Minimal team time tracking for the RepoScout team.

Two concepts only: **tasks** and **time**. No projects, clients, tags,
tasks-within-tasks, or billable rates. A task is a string like
`GM7VKNDN9Y3F-otp-resend-onboarding` (slug, dash, kebab description);
entries attach to tasks, and durations round to the nearest half hour
when saved. The individual contributor's entire surface is the Timer
page: type or pick a task, hit Start. See `docs/PLAN.md` for the full
rationale and API contract.

## Quickstart

```bash
npm install
npm run seed   # resets data/opentime.db with a sample team + 10 weeks of entries
npm run dev    # http://localhost:3000
```

Seeded logins:

| Who | Email | Password |
|---|---|---|
| Admin | `drew@gilli.am` | `opentime-dev` |
| Members | `ada@reposcout.dev`, `grace@reposcout.dev`, `alan@reposcout.dev`, `margaret@reposcout.dev`, `katherine@reposcout.dev` | `password123` |

On an empty database (no seed), the app walks you through `/setup` to
create the admin account. Admins create members from the Team page —
there is no self-registration.

## Roles

- **Admin** (exactly one): sees every member's calendar and reports,
  manages the team.
- **Member**: sees only their own data. Enforced server-side — API
  requests for another user's data return 403 regardless of UI.

## Pages

- **Timer** — task autocomplete (your previously used tasks), start/stop,
  today's entries.
- **Calendar** — month grid with rounded hours per day, plus a
  GitHub-style 12-month activity heatmap.
- **Reports** — hours by task over a date range; admin can view any
  member or group by user.
- **Team** (admin) — member list + add member.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build (must pass before any commit) |
| `npm start` | Run the production build |
| `npm test` | Data-layer + authorization tests (Vitest) |
| `npm run seed` | Reset and re-seed the local SQLite database |

## Architecture

- **Next.js 15, App Router, TypeScript.** Client pages behind a session
  gate (`AppShell`), talking to the API through the typed client in
  `src/lib/api.ts`. Plain CSS design system in `src/app/globals.css`
  (cal.com-inspired tokens, light/dark via `prefers-color-scheme`).
- **SQLite via `better-sqlite3`** at `data/opentime.db` (gitignored).
  Schema applied idempotently in `src/lib/db.ts`; queries in
  `src/lib/repo.ts`.
- **Auth**: email + password (scrypt via `node:crypto`), httpOnly session
  cookie whose token is stored only as a SHA-256 hash. Route guards in
  `src/lib/auth.ts`. Note: the session cookie should gain `secure: true`
  when deployed behind HTTPS.
- **API shape**: `{ "data": ... }` on success, `{ "error": "message" }`
  with 400/401/403/404/409 on failure. Full contract in `docs/PLAN.md`.
- **Rounding**: `duration_secs = max(0.5h, nearest 0.5h)` computed at
  save; raw start/stop timestamps are preserved, so the rounding policy
  can change later without data loss.

## Roadmap: SaaS-ready, not SaaS

Multi-tenancy, invoicing, and integrations are out of scope for now. The
data model keeps the path open: explicit user ids everywhere, tasks as
first-class entities, and raw timestamps under the rounded durations.
Projects may return later as an optional grouping — the IC simplicity of
the Timer page must not regress.
