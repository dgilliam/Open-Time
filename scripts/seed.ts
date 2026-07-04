import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function main() {
  console.log("Seeding database...");

  db.exec("DELETE FROM time_entries");
  db.exec("DELETE FROM projects");
  db.exec("DELETE FROM users");

  const now = new Date().toISOString();

  const users = [
    { id: randomUUID(), name: "Ada Lovelace", email: "ada@reposcout.dev" },
    { id: randomUUID(), name: "Grace Hopper", email: "grace@reposcout.dev" },
    { id: randomUUID(), name: "Alan Turing", email: "alan@reposcout.dev" },
  ];
  const insertUser = db.prepare(
    "INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const u of users) insertUser.run(u.id, u.name, u.email, now);

  const projects = [
    {
      id: randomUUID(),
      name: "RepoScout Core",
      client: "Internal",
      color: "#4f46e5",
      hourlyRateCents: 12000,
    },
    {
      id: randomUUID(),
      name: "Acme Onboarding",
      client: "Acme Corp",
      color: "#0ea5e9",
      hourlyRateCents: 9500,
    },
    {
      id: randomUUID(),
      name: "Open Source Maintenance",
      client: null,
      color: "#16a34a",
      hourlyRateCents: null,
    },
    {
      id: randomUUID(),
      name: "Internal Tooling",
      client: null,
      color: "#f59e0b",
      hourlyRateCents: null,
    },
  ];
  const insertProject = db.prepare(
    `INSERT INTO projects (id, name, client, color, hourly_rate_cents, archived, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  );
  for (const p of projects) {
    insertProject.run(p.id, p.name, p.client, p.color, p.hourlyRateCents, now);
  }

  const insertEntry = db.prepare(
    `INSERT INTO time_entries (id, user_id, project_id, note, started_at, stopped_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const notes = [
    "Bug triage",
    "Feature work",
    "Code review",
    "Client sync",
    "Writing docs",
    "Investigating flaky test",
    "Pairing session",
    "Sprint planning",
  ];

  let entryCount = 0;

  // ~2 weeks of plausible entries for all users, skipping weekends.
  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const dayDate = new Date();
    dayDate.setUTCDate(dayDate.getUTCDate() - dayOffset);
    const dow = dayDate.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip weekends

    for (const user of users) {
      // 1-2 entries per user per day
      const entriesToday = 1 + Math.floor(Math.random() * 2);
      let hour = 9;
      for (let i = 0; i < entriesToday; i++) {
        const project = projects[Math.floor(Math.random() * projects.length)];
        const durationHours = 1 + Math.random() * 3;
        const startedAt = isoDaysAgo(dayOffset, hour, 0);
        const stoppedAtDate = new Date(startedAt);
        stoppedAtDate.setMinutes(
          stoppedAtDate.getMinutes() + Math.round(durationHours * 60)
        );
        const note = notes[Math.floor(Math.random() * notes.length)];

        insertEntry.run(
          randomUUID(),
          user.id,
          project.id,
          note,
          startedAt,
          stoppedAtDate.toISOString(),
          now
        );
        entryCount++;
        hour += Math.ceil(durationHours) + 1;
      }
    }
  }

  // One currently-running timer for the first user.
  const runningStart = new Date();
  runningStart.setMinutes(runningStart.getMinutes() - 42);
  insertEntry.run(
    randomUUID(),
    users[0].id,
    projects[0].id,
    "Working on the timesheet view",
    runningStart.toISOString(),
    null,
    now
  );
  entryCount++;

  console.log(
    `Seeded ${users.length} users, ${projects.length} projects, ${entryCount} time entries (1 running).`
  );
}

main();
