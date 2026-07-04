# Open-Time — MVP Plan

Owner: orchestrator model. Executors implement against this document and do
not change it.

## Product

Time tracking for the RepoScout team, designed so the core can later become a
multi-tenant SaaS. MVP is single-team, no auth: a user picker stands in for
login, and every API call carries an explicit `userId` so real auth can be
added without rewiring.

MVP capabilities:
1. Start/stop a live timer against a project with a note.
2. Add/edit/delete manual time entries.
3. Manage projects (name, client, color, hourly rate, archive).
4. Manage team members (name, email).
5. Weekly timesheet view per user.
6. Report: hours (and billable value) per project and per user over a date
   range, with CSV export.

Deliberately out of scope for MVP: auth, multi-team/tenancy, invoicing,
integrations, mobile. The schema keeps these reachable (rates on projects,
explicit user ids) but we build none of it now.

### Positioning vs solidtime (product north star, 2026-07-04)

solidtime is the closest existing product to what we want, but its
hierarchy — Organization → Members → Clients → Projects → Tasks, with
billable rates at four levels plus roles and approvals — is too heavy for
the individual contributor. Open-Time deliberately flattens all of it:

- No organization or client entities. A project's "client" is an optional
  text label, nothing more. Never promote it to a table without an explicit
  product decision.
- No tasks. The free-text note on a time entry is the only sub-project
  granularity.
- One optional hourly rate, on the project. No member/org rate overrides.
- The IC's entire daily surface is the Timer page: pick project, optionally
  type a note, start. Two interactions, zero hierarchy.

When in doubt, cut. Admin/SaaS features layer on later; IC simplicity is
the moat and must never regress.

## Stack

- Next.js 15, App Router, TypeScript, `src/` directory. No Tailwind — plain
  CSS in `src/app/globals.css` with CSS variables for theming.
- SQLite via `better-sqlite3`, file at `data/opentime.db` (gitignored).
  Schema applied idempotently in `src/lib/db.ts` (CREATE TABLE IF NOT EXISTS).
- Vitest for tests, exercising the data layer directly against a temp DB.

## Schema

```sql
users(id TEXT PK, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL)
projects(id TEXT PK, name TEXT NOT NULL, client TEXT, color TEXT NOT NULL,
         hourly_rate_cents INTEGER, archived INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL)
time_entries(id TEXT PK,
             user_id TEXT NOT NULL REFERENCES users(id),
             project_id TEXT NOT NULL REFERENCES projects(id),
             note TEXT NOT NULL DEFAULT '',
             started_at TEXT NOT NULL,   -- ISO-8601 UTC
             stopped_at TEXT,            -- NULL = timer running
             created_at TEXT NOT NULL)
```

IDs are `crypto.randomUUID()`. At most one running entry
(`stopped_at IS NULL`) per user — starting a timer auto-stops any running one.

## API contract

All under `/api`. Success: `{ "data": ... }`. Error: `{ "error": "msg" }`
with 400/404/409. Executors implement exactly these routes:

| Method & path | Behavior |
|---|---|
| GET `/api/users` | list users |
| POST `/api/users` | create `{name, email}` |
| GET `/api/projects?includeArchived=1` | list projects (default: active only) |
| POST `/api/projects` | create `{name, client?, color?, hourlyRateCents?}` |
| PATCH `/api/projects/[id]` | partial update incl. `archived` |
| GET `/api/entries?userId=&from=&to=` | list entries, newest first; `from`/`to` ISO dates filter on `started_at` |
| POST `/api/entries` | create manual entry `{userId, projectId, note?, startedAt, stoppedAt}` (both times required, stoppedAt > startedAt) |
| PATCH `/api/entries/[id]` | partial update of note/projectId/startedAt/stoppedAt |
| DELETE `/api/entries/[id]` | delete |
| GET `/api/timer?userId=` | running entry or `{ data: null }` |
| POST `/api/timer/start` | `{userId, projectId, note?}`; auto-stops any running entry for that user |
| POST `/api/timer/stop` | `{userId}`; 409 if nothing running |
| GET `/api/reports?from=&to=&groupBy=project\|user` | `{ groups: [{id, name, seconds, billableCents}], totalSeconds }` (billableCents null when no rate) |
| GET `/api/reports/csv?from=&to=` | CSV download of entries in range |

Entry objects are returned with joined `projectName`, `projectColor`,
`userName` so the UI never needs client-side joins.

## Pages

- `/` Timer + today: user picker (persisted in localStorage), big
  start/stop timer with project select + note, list of today's entries with
  inline edit/delete.
- `/timesheet` Week grid for the selected user: days × projects, cell totals,
  week navigation.
- `/projects` CRUD + archive toggle, color dot, rate.
- `/reports` Date-range presets (this week, last week, this month), group by
  project/user, totals table with billable value, CSV export button.
- Shared layout with left nav, RepoScout-neutral styling: system font stack,
  one accent color `#4f46e5`, light/dark via `prefers-color-scheme`.
- Team members are created via an "Add teammate" dialog on the nav's user
  picker (name + email only — no roles, no user management page). This is
  the entire team-management surface; do not grow it without a product
  decision.

## Task breakdown (sequential Sonnet executor runs)

1. **T1 — Scaffold + data layer + API.** Full Next.js scaffold (manual
   package.json, no create-next-app), `src/lib/db.ts`, `src/lib/repo.ts`
   (all queries), every API route above, `scripts/seed.ts` (3 users, 4
   projects, two weeks of plausible entries), `.gitignore`, vitest setup with
   data-layer tests. Done = `npm run build` passes, `npm test` passes.
2. **T2 — UI.** All four pages + layout against the API contract, fetch via a
   tiny typed client in `src/lib/api.ts`. Done = `npm run build` passes and
   pages render against seeded data.
3. **T3 — Polish + docs.** README rewrite (setup, commands, architecture,
   SaaS roadmap note), empty states, error toasts, loading states. Done =
   build + tests pass.

Orchestrator reviews the diff after each task and does final end-to-end
review (seed, run, exercise API) before commit.
