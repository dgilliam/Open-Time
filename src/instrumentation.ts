// Next.js 15 instrumentation hook: `register()` runs once when the server
// process starts (in every runtime the app uses). We only want the nightly
// backup schedule for the Node.js server runtime in production, and never
// more than once even if the framework happens to call register() again.
let registered = false;

export async function register() {
  if (registered) return;
  registered = true;

  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.OPENTIME_BACKUPS === "0") return;

  // Dynamic import: better-sqlite3 is a native module and must stay out of
  // the Edge runtime's bundle graph. instrumentation.ts itself is bundled
  // for both runtimes, but this import only ever executes in the nodejs
  // branch above, so it's safe to pull in the backup module here.
  const { runBackup } = await import("./lib/backup");

  const runScheduled = () => {
    runBackup().catch((err) => {
      console.error("[backup] scheduled backup failed:", err);
    });
  };

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    runScheduled();
    setInterval(runScheduled, ONE_DAY_MS);
  }, 60_000);

  console.log("[backup] scheduled nightly backups (first run in ~60s, then every 24h)");
}
