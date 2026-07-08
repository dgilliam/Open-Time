import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

const DEFAULT_KEEP = 14;
const FILENAME_RE = /^opentime-\d{4}-\d{2}-\d{2}\.db$/;

export interface BackupResult {
  /** Path to the snapshot written by this run. */
  path: string;
  /** Filenames deleted by the retention prune, if any. */
  pruned: string[];
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function resolveDir(dir?: string): string {
  if (dir) return dir;
  if (process.env.OPENTIME_BACKUP_DIR) return process.env.OPENTIME_BACKUP_DIR;
  // db.name is the resolved filename better-sqlite3 opened; default to a
  // `backups/` sibling directory next to it.
  return path.join(path.dirname(db.name), "backups");
}

function resolveKeep(keep?: number): number {
  if (typeof keep === "number") return keep;
  const envKeep = process.env.OPENTIME_BACKUP_KEEP ? Number(process.env.OPENTIME_BACKUP_KEEP) : NaN;
  return Number.isFinite(envKeep) && envKeep > 0 ? envKeep : DEFAULT_KEEP;
}

/**
 * Date stamp (YYYY-MM-DD) of the newest snapshot on disk, or null when no
 * backups exist yet. Read straight from the filenames so it stays accurate
 * regardless of which process wrote the snapshot.
 */
export function latestBackupDate(dir?: string): string | null {
  const resolved = resolveDir(dir);
  let files: string[];
  try {
    files = fs.readdirSync(resolved);
  } catch {
    return null; // backup dir not created yet
  }
  const newest = files.filter((f) => FILENAME_RE.test(f)).sort().reverse()[0];
  return newest ? newest.slice("opentime-".length, -".db".length) : null;
}

/**
 * Writes a consistent online snapshot of the live database using
 * better-sqlite3's native `db.backup()` (safe to run while the app is
 * serving traffic), then prunes older same-pattern snapshots beyond the
 * retention count.
 */
export async function runBackup(opts?: { dir?: string; keep?: number }): Promise<BackupResult> {
  const dir = resolveDir(opts?.dir);
  const keep = resolveKeep(opts?.keep);
  fs.mkdirSync(dir, { recursive: true });

  const destPath = path.join(dir, `opentime-${todayStamp()}.db`);
  await db.backup(destPath);

  const files = fs
    .readdirSync(dir)
    .filter((f) => FILENAME_RE.test(f))
    .sort()
    .reverse(); // YYYY-MM-DD sorts lexicographically = chronologically; newest first

  const toDelete = files.slice(keep);
  for (const f of toDelete) {
    fs.unlinkSync(path.join(dir, f));
  }

  console.log(
    `[backup] wrote ${destPath}${toDelete.length ? ` (pruned ${toDelete.length} old snapshot${toDelete.length === 1 ? "" : "s"})` : ""}`
  );

  return { path: destPath, pruned: toDelete };
}
