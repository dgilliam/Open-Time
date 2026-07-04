#!/usr/bin/env bash
# Auto-pulls this branch whenever the remote gets new commits, so a local
# `npm run dev` hot-reloads remote work without manual git fetch/pull.
# Usage: npm run sync   (in a second terminal alongside `npm run dev`)
# Optional: SYNC_INTERVAL=10 npm run sync
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
INTERVAL="${SYNC_INTERVAL:-30}"

echo "Syncing branch '$BRANCH' from origin every ${INTERVAL}s — Ctrl-C to stop."

while true; do
  if ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
    echo "$(date +%H:%M:%S) fetch failed (offline?); retrying in ${INTERVAL}s"
    sleep "$INTERVAL"
    continue
  fi

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")

  if [ "$LOCAL" != "$REMOTE" ]; then
    if [ -n "$(git status --porcelain)" ]; then
      echo "$(date +%H:%M:%S) remote updated, but you have local changes — not pulling. Commit/stash them to resume syncing."
    else
      OLD_LOCK=$(git rev-parse HEAD:package-lock.json 2>/dev/null || echo none)
      if git merge --ff-only "origin/$BRANCH" --quiet; then
        NEW_LOCK=$(git rev-parse HEAD:package-lock.json 2>/dev/null || echo none)
        echo "$(date +%H:%M:%S) pulled $(git log --oneline -1)"
        if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
          echo "$(date +%H:%M:%S) dependencies changed — running npm install"
          npm install
        fi
      else
        echo "$(date +%H:%M:%S) cannot fast-forward (local commits diverge from remote) — resolve manually."
      fi
    fi
  fi

  sleep "$INTERVAL"
done
