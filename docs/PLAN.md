# Open-Time — Plan (v2)

Owner: orchestrator model. Executors implement against this document and do
not change it. v1 (projects, no auth, user picker) is superseded; this
section is the source of truth.

## Product v2

Time tracking with exactly two concepts: **task** and **time**.
No projects (may return later), no clients, no rates/billable, no tags.

- A **task** is a user-entered string `SLUG-description`, e.g.
  `GM7VKNDN9Y3F-otp-resend-onboarding`. Tasks are entities: many time
  entries attach to one task. When logging time, the user picks from an
  autocomplete of tasks they have previously logged time to, or types a
  new one (created implicitly on save).
- A **time entry** is task + startedAt + stoppedAt. No note field — the
  task string is the description. Durations are **rounded to the nearest
  0.5h at save time** (minimum 0.5h), stored in `duration_secs`; raw
  start/stop timestamps are preserved unmodified.
- **Roles**: exactly one `admin` (Drew) and unlimited `member`s. Admin
  sees everyone's calendars/reports and manages users. Members see only
  their own data — enforced server-side, not just hidden in the UI.
- **Auth**: email + password sessions. No self-registration; admin
  creates users. First-run `/setup` creates the admin account when the
  users table is empty.
- **Calendar view** replaces the timesheet: month grid showing rounded
  hours per day, plus a GitHub-contributions-style heatmap strip (last
  ~12 months, color intensity = hours/day).

IC surface: type/pick task → Start. One interaction.

## Stack

Unchanged: Next.js 15 App Router + TypeScript, better-sqlite3 at
`data/opentime.db`, plain CSS design system (see Design system section),
vitest. Password hashing via `node:crypto` scrypt (no new native deps).
Session cookie `ot_session` (httpOnly, sameSite=lax), token stored hashed
in `sessions` table, 30-day expiry.

## Schema v2 (destructive reset — v1 tables dropped, seed data rebuilt)

```sql
users(id TEXT PK, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      created_at TEXT NOT NULL)
sessions(token_hash TEXT PK, user_id TEXT NOT NULL REFERENCES users(id),
         expires_at TEXT NOT NULL, created_at TEXT NOT NULL)
tasks(id TEXT PK, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)
time_entries(id TEXT PK,
             user_id TEXT NOT NULL REFERENCES users(id),
             task_id TEXT NOT NULL REFERENCES tasks(id),
             started_at TEXT NOT NULL,          -- ISO-8601 UTC, raw
             stopped_at TEXT,                   -- NULL = running
             duration_secs INTEGER,             -- NULL while running; rounded on save
             created_at TEXT NOT NULL)
```

Task name validation: trimmed, 3–120 chars, must match
`^[A-Za-z0-9]+-[A-Za-z0-9][A-Za-z0-9-]*$` (slug, dash, kebab rest); the
slug segment is uppercased on save, the rest lowercased. Reject with a
helpful 400 otherwise.

Rounding rule (applied on manual create/update and on timer stop):
`duration_secs = max(1800, round(rawSeconds / 1800) * 1800)`.
Calendar, reports, and entry lists always display from `duration_secs`.
At most one running entry per user; starting a timer auto-stops (and
rounds) any running one.

## API contract v2

Success `{ data }`, error `{ error }` with 400/401/403/404/409.
Every route except `/api/auth/*` and `/api/setup` requires a valid
session. "Self or admin" = members may only target themselves; admins may
target anyone via `userId` param.

| Method & path | Behavior |
|---|---|
| GET `/api/setup` | `{ needed: boolean }` (true when zero users) |
| POST `/api/setup` | create admin `{name,email,password}`; 409 if users exist |
| POST `/api/auth/login` | `{email,password}` → sets session cookie, returns user (sans hash) |
| POST `/api/auth/logout` | clears session |
| GET `/api/auth/me` | current user or `{ data: null }` |
| GET `/api/users` | admin only: list users |
| POST `/api/users` | admin only: create member `{name,email,password}` |
| GET `/api/tasks?q=` | tasks the CURRENT user has logged time to, filtered by substring, most recently used first, limit 20 |
| GET `/api/entries?userId=&from=&to=` | self or admin; newest first |
| POST `/api/entries` | `{task, startedAt, stoppedAt}` for SELF; find-or-create task; validates + rounds |
| PATCH `/api/entries/[id]` | owner or admin; `{task?, startedAt?, stoppedAt?}`; re-rounds |
| DELETE `/api/entries/[id]` | owner or admin |
| GET `/api/timer` | self: running entry or null |
| POST `/api/timer/start` | `{task}` for self; find-or-create task; auto-stop rule |
| POST `/api/timer/stop` | self; 409 if nothing running; rounds |
| GET `/api/calendar?userId=&from=&to=` | self or admin: `[{date: 'YYYY-MM-DD', hours}]` (local-date bucketing by started_at, hours from duration_secs) |
| GET `/api/reports?userId=&from=&to=&groupBy=task\|user` | groupBy=task: self or admin-targeted user. groupBy=user: admin only. `{groups:[{id,name,hours}], totalHours}` |

Entries are returned with joined `taskName` (and `userName` for admin
queries). Auth helper `requireUser(req)` / `requireAdmin(req)` in
`src/lib/auth.ts`; route handlers stay thin.

## Pages v2

- `/login` — email + password, error inline. Redirects to `/` when
  already signed in. `/setup` — shown only when no users exist (server
  checks); creates admin then signs in.
- `/` Timer + today: task combobox (autocomplete from `/api/tasks?q=`,
  free text allowed, monospace styling for the slug), Start/Stop hero,
  today's completed entries (task, start–stop, rounded duration,
  edit/delete).
- `/calendar` — month grid (Mon–Sun columns), each day cell shows rounded
  hours (e.g. `6.5h`) with a subtle background tint scaled by hours;
  month prev/next/today nav. Below: GitHub-style heatmap of the last 12
  months (weeks as columns, 5 intensity buckets: 0, <2, 2–4, 4–6, 6+ h),
  with weekday labels and month labels, tooltip `date — Xh`. Admin only:
  a person selector above the calendar; members see only themselves.
- `/reports` — presets (This week, Last week, This month) + custom range;
  table of hours by task for the viewed user; admin can switch person or
  group by user. Hours only — no billable column. CSV export dropped for
  now (no consumer identified); revisit on request.
- `/team` — admin only: user list (name, email, role) + "Add member"
  dialog (name, email, temp password). Members never see this page.
- Nav: Timer, Calendar, Reports (+ Team for admin). Bottom of nav: signed-
  in user's name + Sign out. No user toggling outside admin data views.

Design system unchanged (see below). The heatmap uses the accent scale.

## Design system (v2 restyle, 2026-07-04)

Written from scratch in our own CSS, visually inspired by cal.com's design
language (their code is AGPL — never copy styles from their repo). All
tokens are CSS variables in `:root` / dark override so RepoScout brand
colors can be swapped in one place later.

- Typeface: `Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial,
  sans-serif` (no webfont download; Inter used when locally installed).
- Neutrals (light): page `#ffffff`, subtle surface `#f9fafb`, border
  `#e5e7eb`, text `#111827`, muted `#6b7280`.
- Neutrals (dark): page `#101010`, surface `#171717`, border `#2e2e2e`,
  text `#f3f4f6`, muted `#9ca3af`.
- Accent `--accent: #4f46e5` — active nav, running-timer highlight, focus
  details, heatmap scale. Placeholder until RepoScout brand hexes arrive.
- Buttons: 6px radius, 500 weight, 36px height. Primary near-black solid
  (inverts in dark mode); secondary bordered; danger `#dc2626`; btn-link.
  `:focus-visible` 2px offset ring.
- Inputs/selects: 1px border, 6px radius, button height, focus ring.
- Surfaces: 1px border, 8px radius cards; tables with 12px uppercase
  muted headers, 1px separators, right-aligned tabular-nums numerics.
- Nav: subtle-surface sidebar, 1px right border, soft-pill links.

## Task breakdown (sequential executor runs)

1. **T5 — Backend v2.** New schema (drop v1 tables at startup if the old
   `projects` table exists — dev-only destructive migration), auth
   (`src/lib/auth.ts`: scrypt hash/verify, session create/lookup/delete,
   cookie helpers), rewrite `src/lib/repo.ts` for tasks/entries/rounding,
   all API routes v2 (delete project routes), seed v2 (admin
   drew@gilli.am / password `opentime-dev`, 3 members password
   `password123`, ~30 tasks in slug format, 10 weeks of entries with
   realistic density incl. empty days), rewrite tests: rounding math,
   task find-or-create + validation + per-user autocomplete scoping,
   auth (hash/verify, session expiry), authorization (member cannot read
   another user's entries), calendar bucketing. Old UI pages may 500
   against the new API — acceptable; T6 follows immediately. Done =
   build passes, tests pass.
2. **T6 — UI v2.** Login/setup pages, session-aware nav (name + sign
   out, Team link for admin), timer with task combobox, calendar page
   (month grid + heatmap), reports rework, team page, delete projects
   page and dead components/api-client methods. Done = build + tests
   pass, Playwright walkthrough: login as admin, start/stop timer,
   calendar renders with heatmap, member login sees only self, member
   hitting another userId gets 403.
3. **T7 — Review & polish.** Orchestrator end-to-end review; README
   update (auth model, task format, roles); small fixes.
