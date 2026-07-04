// v1's weekly timesheet is replaced in v2 by /calendar (month grid + heatmap,
// see docs/PLAN.md). This page is a compile-safe stub left for T6, which
// builds /calendar and removes this route.
export default function TimesheetPage() {
  return (
    <div className="page">
      <h1>Timesheet</h1>
      <p className="muted">Replaced by the v2 Calendar view — coming next.</p>
    </div>
  );
}
