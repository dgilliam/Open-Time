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
4. **Build/start commands** — Railway auto-detects this as a Next.js app:
   build `npm run build`, start `npm start`. No changes needed; `next
   start` already honors Railway's injected `PORT`.
5. **Domain** — use Railway's generated `*.up.railway.app` domain, or add
   a custom domain (create the CNAME Railway gives you). HTTPS is
   automatic either way, which is what makes the session cookie's
   `secure` flag work in production (see `src/lib/auth.ts`).

## First run

- Visit `/setup` once the service is live and create the **admin**
  account with a strong password — the users table starts empty, and
  `/setup` only works while it's empty.
- Add teammates from `/team` (admin only) and share their passwords with
  them directly. There's no self-registration and no password-reset flow
  in this MVP.
- **Never run `npm run seed` against production.** It wipes all data and
  recreates demo users with public, well-known passwords. It's a local
  dev convenience only.

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
- If the deploy sits behind a proxy whose request origin isn't the
  public URL, set `OPENTIME_BASE_URL=https://time.reposcout.com` so the
  callback URL sent to Google matches the one registered.

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
