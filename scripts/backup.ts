// Manual backup runner: `npm run backup`.
import { runBackup } from "../src/lib/backup";

runBackup()
  .then((result) => {
    console.log(`Backup written: ${result.path}`);
    if (result.pruned.length) {
      console.log(`Pruned ${result.pruned.length} old snapshot(s): ${result.pruned.join(", ")}`);
    }
  })
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
