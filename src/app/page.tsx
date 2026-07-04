// v1's Timer page depended on a Project picker and a per-entry note field,
// both gone in v2 (task combobox + Start/Stop hero, see docs/PLAN.md). This
// page is a compile-safe stub left for T6, which rebuilds it against the new
// /api/timer, /api/entries, and /api/tasks contract.
export default function Home() {
  return (
    <div className="page">
      <h1>Timer</h1>
      <p className="muted">
        The v2 timer UI (task combobox, Start/Stop, today’s entries) lands
        next. The backend is ready at /api/timer, /api/entries, and
        /api/tasks.
      </p>
    </div>
  );
}
