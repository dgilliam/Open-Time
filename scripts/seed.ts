import { db } from "../src/lib/db";
import * as repo from "../src/lib/repo";

function isoDaysAgo(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

// ~30 tasks in SLUG-kebab-description format.
const TASK_NAMES = [
  "GM7VKNDN9Y3F-otp-resend-onboarding",
  "A1B2C3-fix-login-bug",
  "K9X2Y8-refactor-timer-ui",
  "PQ44-write-migration-script",
  "ZT9-investigate-flaky-test",
  "R2D2-pairing-session-billing",
  "OPS12-rotate-db-credentials",
  "UX8-design-calendar-heatmap",
  "BUG205-fix-timezone-offset",
  "API3-add-rate-limiting",
  "DOCS1-update-readme",
  "INFRA9-upgrade-node-version",
  "SEC4-audit-session-expiry",
  "PERF7-optimize-entries-query",
  "QA22-write-e2e-tests",
  "SUP19-customer-escalation-call",
  "CORE5-task-autocomplete-endpoint",
  "CORE6-rounding-math-review",
  "TEAM3-onboard-new-member",
  "REL8-cut-release-notes",
  "BUG301-fix-duplicate-entries",
  "UX9-polish-nav-sidebar",
  "API4-calendar-endpoint",
  "INFRA10-backup-automation",
  "SEC5-scrypt-password-hash",
  "PERF8-index-time-entries",
  "QA23-load-test-timer-start",
  "SUP20-triage-support-inbox",
  "CORE7-reports-groupby-user",
  "REL9-tag-v2-release",
] as const;

function main() {
  console.log("Seeding database...");

  db.exec("DELETE FROM time_entries; DELETE FROM sessions; DELETE FROM tasks; DELETE FROM users;");

  const admin = repo.createUser({
    name: "Drew",
    email: "drew@gilli.am",
    password: "opentime-dev",
    role: "admin",
  });

  const memberDefs = [
    { name: "Ada Lovelace", email: "ada@reposcout.dev" },
    { name: "Grace Hopper", email: "grace@reposcout.dev" },
    { name: "Alan Turing", email: "alan@reposcout.dev" },
  ];
  const members = memberDefs.map((m) =>
    repo.createUser({ name: m.name, email: m.email, password: "password123", role: "member" })
  );
  const allUsers = [admin, ...members];

  const tasks = TASK_NAMES.map((name) => repo.findOrCreateTask(name));

  let entryCount = 0;
  const totalDays = 70; // 10 weeks

  for (const user of allUsers) {
    for (let daysAgo = 1; daysAgo <= totalDays; daysAgo++) {
      const dayDate = new Date();
      dayDate.setUTCDate(dayDate.getUTCDate() - daysAgo);
      const dow = dayDate.getUTCDay(); // 0 = Sunday .. 6 = Saturday
      const isWeekend = dow === 0 || dow === 6;

      // Weekends are mostly empty; weekdays occasionally empty too, so the
      // calendar heatmap has realistic gaps rather than solid coverage.
      if (isWeekend && Math.random() > 0.12) continue;
      if (!isWeekend && Math.random() < 0.15) continue;

      const entriesToday = 1 + Math.floor(Math.random() * 2);
      let hour = 9;
      for (let i = 0; i < entriesToday; i++) {
        if (hour > 18) break;
        const task = tasks[Math.floor(Math.random() * tasks.length)];
        const durationHours = 0.5 + Math.random() * 3.5;
        const startedAt = isoDaysAgo(daysAgo, hour, Math.floor(Math.random() * 60));
        const stoppedAt = new Date(
          new Date(startedAt).getTime() + durationHours * 3_600_000
        ).toISOString();

        repo.createEntry({ userId: user.id, task: task.name, startedAt, stoppedAt });
        entryCount++;
        hour += Math.ceil(durationHours) + 1;
      }
    }
  }

  console.log(
    `Seeded ${allUsers.length} users (1 admin, ${members.length} members), ${tasks.length} tasks, ${entryCount} time entries.`
  );
  console.log("Admin login: drew@gilli.am / opentime-dev");
  console.log(`Member logins: ${members.map((m) => m.email).join(", ")} / password123`);
}

main();
