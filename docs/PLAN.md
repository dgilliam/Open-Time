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

Task name rules (relaxed 2026-07-05 — the strict SLUG-only format was
rejecting legitimate free-text tasks like "internal meeting"):
- Trimmed, internal whitespace runs collapsed to one space, 2–120 chars;
  outside that → 400.
- If the name matches `^[A-Za-z0-9]+-[A-Za-z0-9][A-Za-z0-9-]*$` it is
  treated as a slug task and normalized (slug uppercased, rest
  lowercased), preserving the original ticket-style behavior.
- Anything else is accepted verbatim as free text (casing preserved).
- Find-or-create matches case-insensitively so "Internal Meeting" and
  "internal meeting" are one task (first-seen casing wins).

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

## v2.1 — Weekly timesheet grid + report dates (2026-07-04)

### Timesheet page `/timesheet` (all roles, self-only data)

Modeled on the solidtime-style weekly grid the founder supplied:

- Header: `‹` `›` week nav, label `This week · W27` (or `Jun 28 – Jul 4 ·
  W27` for other weeks; ISO week number of that span's Monday), right-
  aligned `WEEK TOTAL 12h 00min`.
- Columns: **Sun-first** (`Sun 28` … `Sat 4`), matching the reference.
- Rows: one per task the user has completed entries for that week (plus
  manually added rows); cells show the summed rounded duration for that
  task+day as `3h 00min` chips, `-` when empty. Bottom `Total` row per
  day. This page uses `Xh YYmin` formatting; the rest of the app keeps
  decimal hours.
- Cells are editable: click → inline input accepting `3`, `3.5`, `3:30`,
  or `3h 30m`; on save, rounds to 0.5h steps and **replaces that
  task+day's completed entries with a single synthetic entry** starting
  at 09:00 local that day. Entering 0 (or clearing) deletes them.
  Running entries are never touched or counted by the grid.
- `+ Add row`: task combobox (same component as Timer) adds an empty row
  client-side. (A "Copy last week" affordance was built then cut
  2026-07-04: rows materialize from entries automatically here, so
  copying rows without hours added nothing.)
- Nav order: Timer, Timesheet, Calendar, Reports (+ Team admin-only).

### API additions/changes

| Method & path | Behavior |
|---|---|
| PUT `/api/timesheet/cell` | self only: `{task, date: 'YYYY-MM-DD', hours}`. Transactionally deletes the caller's COMPLETED entries for that task+local-date and, when hours > 0, inserts one entry `09:00 local + rounded duration`. Returns the new cell hours. 400 on bad hours (<0 or >24) or task format. |
| GET `/api/reports` | task groups gain `dates: ['YYYY-MM-DD', …]` (distinct local dates worked, ascending) and `lastWorked`; ALL report groups now sort by most recent activity desc (was: seconds desc). |

### Reports page changes

- New "Dates" column for task grouping: ≤3 dates → listed (`Jul 1,
  Jul 2`), otherwise `Jun 29 – Jul 4 · 5 days`.
- Rows sorted by most recently worked first (per the API change).

## v2.2 — Admin dashboard (2026-07-04)

The admin role's purpose: consolidated hours by task, by contributor, and
team-wide, plus the ability to edit any entry. Members remain strictly
self-only (unchanged, already enforced).

### API changes (admin-only surface area)

- GET `/api/entries?userId=all` — admin only: everyone's entries (userName
  already joined). Members passing `all` (or any other user) still 403.
- GET `/api/reports?userId=all&groupBy=task` — admin only: task groups
  aggregated across the whole team; each group gains
  `contributors: [{id, name, hours}]` (desc by hours). `groupBy=user`
  unchanged. Existing single-user and self behavior unchanged.
- No new mutation endpoints: PATCH/DELETE `/api/entries/[id]` already
  authorize owner-or-admin; the dashboard reuses them.

### Page `/dashboard` (admin only; members redirected to `/`)

Nav for admin: Dashboard, Timer, Timesheet, Calendar, Reports, Team —
Dashboard first and is the admin's post-login landing page. Sections, all
driven by one date-range picker (presets This week / Last week / This
month / custom):

1. **Team** — stat row: team total hours, active contributors, entries
   count. Then per-contributor table (every member listed even at 0h in
   range: name, hours, active days, last worked), total row.
2. **Tasks** — consolidated by task: task (mono), total hours,
   contributors (compact: names with hours), dates worked (compact format
   from v2.1). Sorted by recency, per the API.
3. **Entries** — member filter (All + each member) + the range; table of
   entries (member, task, date, start–stop, duration) with Edit/Delete
   reusing the existing EntryDialog — this is where admin corrects
   anyone's entry. Newest first, cap at 200 rows with a "showing first
   200" note.

Seed: bump to 5 members (add two more ICs) so the dashboard reflects the
real team shape. Next up (not this task): admin-only export from the
dashboard's data.

Addendum (2026-07-05): all three dashboard tables get click-to-sort
headers — client-side, text columns default asc / numeric+date columns
default desc on first click, second click flips, ▲/▼ indicator +
aria-sort on the active column. Defaults unchanged (Team: hours desc,
Tasks: recency, Entries: newest first); the 200-row entries cap applies
after sorting.

## v2.3 — Responsive layout (2026-07-05)

Problem: horizontal overflow at narrow viewports (e.g. Arc/Dia browser
side panels). Goal: no page-level horizontal scroll at any width; usable
down to phone size. Wide content (tables, timesheet grid, heatmap)
scrolls inside its own container, never the page.

- **Nav**: desktop (≥900px) keeps the sidebar, now collapsible via a
  button in the nav (chevron); collapsed state persisted in
  localStorage `opentime.navCollapsed`, with a floating expand button.
  Below 900px the sidebar becomes an off-canvas drawer, closed by
  default, over a scrim, opened from a slim top bar (hamburger +
  wordmark); route change or scrim tap closes it.
- **Overflow guards**: `overflow-x: hidden` on body plus audit — every
  table/grid/heatmap wrapped in an `overflow-x: auto` container;
  toolbars `flex-wrap`; `.app-main` fluid width with reduced padding at
  narrow sizes; stat cards stack under 640px; dialogs near-full-width
  under 640px.
- **No functional changes** — same pages, same data, same tests.

## v2.4 — CSV export from /reports (2026-07-05)

Purpose: founder models the data in Google Sheets. Flat entry-level CSV,
available to BOTH roles from the /reports page, honoring the page's
active filters.

- GET `/api/reports/csv?from=&to=&userId=` — requireUser;
  `userId` defaults to self; members may only target themselves
  (assertSelfOrAdmin, same as everywhere); admin may pass any user id or
  `all`. Completed entries only, ordered by date asc then member name.
- Columns exactly: `member,task,duration_hours,date` — duration as
  decimal hours (0.5, 2.5), date as YYYY-MM-DD (local bucketing,
  consistent with calendar/reports). No start/stop times.
- Content-Type text/csv, Content-Disposition attachment, filename
  `opentime_<from>_<to>.csv` (dates only). Proper quoting for commas/
  quotes/newlines in free-text task names.
- /reports UI: secondary "Export CSV" button in the toolbar (plain <a>
  so the session cookie rides along). URL reflects the CURRENT view:
  task grouping → the viewed user (self for members, selected person
  for admin); user grouping (admin-only) → `all`. Range = the active
  preset/custom From–To exactly as displayed in the date boxes.

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

### v2.4 addendum (2026-07-05): dashboard entries export

The /dashboard Entries section gets its own "Export CSV" button, honoring
ALL of that section's active filters: date range, member, and project.
To support it, GET `/api/reports/csv` gains an optional `project` param
(admin-relevant): `project=<label>` filters to members currently
assigned that label; the sentinel `project=__none__` filters to
unassigned members; absent = no project filter. Implemented as a
`project` option on `listEntries` (string match / explicit-null / off).
Same columns and auth rules as v2.4.

## v2.5 — Member project assignment (2026-07-05)

Projects return in deliberately minimal form: a project is a text label
on the MEMBER (1 member → 1 project), assigned by the admin in /team,
completely invisible to ICs. Not an entity, no CRUD, no rates, no
per-entry assignment.

Known semantic (founder-approved trade): the label is the member's
CURRENT project — reassigning re-labels all their historical entries in
admin tables and exports. Per-entry snapshots are the future upgrade if
history must survive reassignment.

- Schema: `users.project TEXT` (nullable). Idempotent dev migration in
  db.ts: `ALTER TABLE users ADD COLUMN project TEXT` guarded by a
  pragma table_info check.
- Validation: trimmed, empty → NULL, max 60 chars.
- API: PATCH `/api/users/[id]` (admin only) accepting `{name?, project?}`;
  POST `/api/users` gains optional `project`. `listUsers` includes it;
  `listEntries` rows gain joined `userProject`; report `groupBy=user`
  groups gain `project`. Payload fields exist regardless of caller role
  (it is a work label, not a secret) but NO member-facing UI renders it.
- CSV export columns become: `member,project,task,duration_hours,date`
  (empty string when unassigned).
- Admin UI:
  - /team: Project column; Add-member dialog gains optional Project
    field; new Edit action per member (dialog: name + project — email
    and role stay immutable for now).
  - /dashboard Team table: sortable Project column.
  - /dashboard Entries: sortable Project column + a Project filter
    select (All projects / each distinct project / No project) that
    composes with the member filter; totals keep matching filters.
  - /reports user grouping: Project column.
- IC UI: zero changes. Seed: assign projects to the five members (e.g.
  "AI Assessor", "Platform", one member unassigned) so filters are
  demonstrable.

## v2.6 — Team feedback round 1 (2026-07-05)

Source: first week of real usage. Three changes.

### A. Day navigator + manual time on the Timer page

Bug being fixed: the Timer page lists only "today", and it is the only
IC surface for editing individual entries — so an entry re-dated to the
past becomes unreachable (user report: "option to edit time does not
appear if you edit date 2-3 days back").

- The entries list gains a day navigator: `‹` `›` around a date label
  ("Today", else "Thu, Jul 3"), plus a "Today" reset. Lists that local
  day's completed entries, same edit/delete affordances.
- New "+ Add time" button beside the navigator: opens the entry dialog
  in CREATE mode for the viewed day (task combobox, start/stop time
  inputs prefilled 09:00–09:30 local of that day). Uses the existing
  POST /api/entries (no API change).

### B. Task wrap-up metadata (mirrors the founder's spreadsheet)

Tasks gain three OPTIONAL fields:

```sql
tasks.link TEXT           -- e.g. Slack thread URL (any http(s) URL)
tasks.details TEXT        -- free notes
tasks.status TEXT NOT NULL DEFAULT 'open'
  CHECK(status IN ('open','submitted','accepted','dead_end'))
```

Additive idempotent migration (pragma-guarded ALTERs). Validation:
link must parse as http(s) URL when non-empty (400 otherwise), ≤500
chars; details ≤2000 chars; both trim-to-null.

- PATCH `/api/tasks/[id]` `{link?, details?, status?}` — allowed for
  admin or any user with at least one entry on that task; 403 otherwise,
  404 unknown task. GET `/api/tasks?q=` unchanged (returns new fields).
- Timer stop flow: after a successful stop, the UI offers a skippable
  "Wrap up <task>?" dialog (status select: Keep open / Submitted /
  Accepted / Dead end; link input; details textarea; Save / Skip).
  Stopping is never blocked on it. The same dialog opens from any task
  name click in the Timer page's entries list.
- Status surfaces (badge styling: open=muted, submitted=amber,
  accepted=green, dead_end=red — tokens, works in both themes):
  admin dashboard Tasks table (badge + link icon column, sortable by
  status) and reports task-grouping table (badge after task name,
  link icon when present).
- CSV export gains columns after `task`: `task_status,task_link,
  task_details` (quoting already handles commas/newlines).

### C. Deferred by decision: payment status

Money bookkeeping stays in the founder's sheet (rebuilt from the CSV);
revisit only when invoicing becomes a real feature.

Execution: T18 = schema + repo + API + CSV + tests. T19 = UI (day
navigator, add-time dialog, wrap-up dialog, badges).

Addendum (2026-07-05, T20): clicking a task name ANYWHERE opens the
wrap-up dialog, both roles — dashboard Tasks + Entries tables, reports
task grouping, timesheet row labels (Timer list already does). Members
only ever see tasks they contributed to, so the existing
contributor-or-admin PATCH authorization already fits. Report task
groups additionally carry `details` so the dialog can prefill from any
surface; each surface refetches after save.

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
