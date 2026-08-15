# Deploying Open-Time to Railway

Open-Time is a single Next.js app with a SQLite file on disk — no external
database service needed. This is a runbook, not a tutorial; it assumes you
already have a Railway account and this repo pushed to GitHub.

## Prereqs

- The repo is on GitHub (this repo, or your fork).
- A Railway account with billing set up (a persistent Volume requires a
  paid plan).

## Deploy steps

1. **New Project → Deploy from GitHub repo.** Pick this repo and the
   branch to deploy (`main`).
2. **Attach a Volume**, mounted at `/data`. This is where the SQLite
   database and its backups live, so it must survive redeploys.
3. **Set environment variables** on the service:
   - `OPENTIME_DB=/data/opentime.db`
   - `OPENTIME_BACKUP_DIR=/data/backups`
   - `OPENTIME_BASE_URL=https://<your-domain>` — the public URL as a
     browser sees it. Set this on every production deploy. Without it the
     app has to infer its own address from the `x-forwarded-host` header,
     which is client-supplied data that Railway happens to overwrite;
     that value becomes the OAuth redirect target, so pinning it here
     removes the guesswork. See "Base URL and proxy headers" below.
   - `OPENTIME_SETUP_TOKEN=<long random string>` — required to create the
     admin account at `/setup`. See "First run" below for why this
     matters beyond the initial deploy.
4. **Build/start commands** — Railway auto-detects this as a Next.js app:
   build `npm run build`, start `npm start`. No changes needed; `next
   start` already honors Railway's injected `PORT`.
5. **Domain** — use Railway's generated `*.up.railway.app` domain, or add
   a custom domain (create the CNAME Railway gives you). HTTPS is
   automatic either way, which is what makes the session cookie's
   `secure` flag work in production (see `src/lib/auth.ts`).

## First run

- Visit `/setup` once the service is live and create the **admin**
  account with a strong password. The form asks for the
  `OPENTIME_SETUP_TOKEN` you set above; paste it in.
- Add teammates from `/team` (admin only) and share their passwords with
  them directly. There's no self-registration and no password-reset flow
  in this MVP.
- **Never run `npm run seed` against production.** It wipes all data and
  recreates demo users with passwords published in this repo. The script
  now refuses to run when `NODE_ENV=production`, when
  `RAILWAY_ENVIRONMENT` is set, or when `OPENTIME_DB` points under
  `/data` — but don't rely on that; it's a backstop, not permission to
  be casual.

### Why `/setup` needs a token

`POST /api/setup` creates an **admin** with no authentication — it's
gated only on the users table being empty. That's fine for the minute
between first deploy and your first visit. The lasting risk is different:
if the volume is ever detached, remounted empty, or `OPENTIME_DB` is
repointed, the app recreates an empty schema on boot and `/setup` reopens
on a live, public URL. The first visitor would become admin over your
restored data.

With `OPENTIME_SETUP_TOKEN` set, only someone holding that token can do
it. As a second line of defence, if no token is configured, setup refuses
whenever the backup directory already contains snapshots — an empty users
table plus existing backups means a storage incident, so restore rather
than re-run setup.

## Base URL and proxy headers

`OPENTIME_BASE_URL` takes priority over everything else and is the
recommended production setting. If it's unset, the app falls back to the
first hop of `x-forwarded-host`, accepted only if it's a bare
`hostname[:port]` (no path, no userinfo, no scheme, no CR/LF) with an
`http`/`https` forwarded proto; anything else falls back to the request's
own origin.

`OPENTIME_ALLOWED_HOSTS` (optional, comma-separated) restricts which
forwarded hostnames are accepted. Setting `OPENTIME_BASE_URL` makes it
unnecessary.

## Google sign-in (optional, v3.6)

Adds a "Sign in with Google" button to the login page. Password login
keeps working unchanged — this is additive, and the button only appears
when credentials are configured.

1. In [Google Cloud Console](https://console.cloud.google.com/) create
   (or pick) a project → **APIs & Services → OAuth consent screen**:
   User type **External**, fill in the app name + your email, add no
   scopes beyond the defaults, and add your teammates as test users —
   or click **Publish app** so any Google account can attempt sign-in
   (membership is still enforced by Open-Time; unknown emails are
   refused).
2. **APIs & Services → Credentials → Create credentials → OAuth client
   ID**, type **Web application**. Authorized redirect URIs:
   - `https://time.reposcout.com/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (for local dev)
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Railway
   service (and in a local `.env.local` for dev). Redeploy.

Notes:
- A Google login must match an existing member's email exactly
  (case-insensitive) — there is no self-registration. Members whose
  Google address differs from their Open-Time email should keep using
  their password until an admin updates their record.
- **Auto-provisioning (optional, v3.7):** set
  `GOOGLE_AUTO_PROVISION_DOMAINS` to a comma-separated list of email
  domains (e.g. `reposcout.com,gilli.am`) and a verified Google sign-in
  from one of those domains that matches no member creates a member
  record on first sign-in (role `member`, name from the Google profile,
  unusable random password — Google is their login). Unset = off.
  Removed members are never resurrected this way; restoring them stays
  an admin action on the Team page.
- Set `OPENTIME_BASE_URL=https://time.reposcout.com` (see the deploy
  steps above) so the callback URL sent to Google matches the one
  registered here. Behind Railway's proxy the app's own request origin is
  an internal address, so without this the redirect URI is derived from a
  request header.

## Daily Slack digest (optional, v3.9)

Posts yesterday's hours to a Slack channel each morning: a
`| Member | Hours |` table, per-member task lines, and a "no hours"
footer. Inert until configured — the Dashboard's preview works either
way.

1. Create a Slack app at https://api.slack.com/apps → **From scratch**,
   pick your workspace.
2. **OAuth & Permissions → Bot Token Scopes**: add `chat:write`.
3. **Install to Workspace**, then copy the **Bot User OAuth Token**
   (`xoxb-…`).
4. Invite the bot to the target channel in Slack:
   `/invite @Open-Time` — posting to a channel it isn't in fails with
   `not_in_channel`.
5. Set on the Railway service and redeploy:
   - `SLACK_BOT_TOKEN=xoxb-…`
   - `SLACK_DIGEST_CHANNEL=#time-tracking`

Optional tuning:

| Variable | Default | Meaning |
|---|---|---|
| `OPENTIME_TZ` | `America/Chicago` | Timezone for day boundaries + send hour |
| `OPENTIME_DIGEST_HOUR` | `9` | Local hour (0-23) after which the digest posts |
| `OPENTIME_DIGEST_TASKS` | `1` | `0` = table only, no per-task lines |
| `OPENTIME_DIGEST` | `1` | `0` = disable the scheduler entirely |

Notes:
- The scheduler checks hourly and posts once per day, guarded by a
  `notifications_log` ledger — restarts, deploys, and extra ticks can't
  double-post, and a missed window still posts later the same day.
- Days with no hours logged are skipped silently (no weekend noise).
- Admins can post any day on demand from the Dashboard's digest preview
  ("Send to Slack now"), which always re-posts even if that day already
  went out.

## Operations

- **Run exactly 1 replica.** SQLite is single-writer; horizontal scaling
  will corrupt or lock the database. Do not enable Railway's autoscaling
  or multiple replicas for this service.
- **Backups**: the app schedules a nightly automatic backup itself (first
  run ~60s after boot, then every 24h — see `src/instrumentation.ts`),
  writing to `OPENTIME_BACKUP_DIR` and keeping the 14 newest snapshots.
  For an on-demand backup, run `npm run backup` via `railway run` or a
  Railway shell session against the service.
- **Restore**: stop the service, replace the file at `OPENTIME_DB` with
  the desired snapshot from the backups directory (or an off-platform
  copy), then redeploy/restart the service.
- **Off-platform copies**: periodically download a snapshot from
  `/data/backups` off of Railway (e.g. via `railway run` + `railway
  volume` tooling, or a manual `scp`/download) so you're not solely
  dependent on the Volume. Mirroring backups to R2/S3 automatically is a
  reasonable future addition, not built yet.
