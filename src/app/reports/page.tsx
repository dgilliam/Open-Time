// v1's reports page rendered project/billable columns that no longer exist in
// v2 (ReportResult is now { groups: [{id,name,hours}], totalHours }, see
// docs/PLAN.md). This page is a compile-safe stub left for T6, which rebuilds
// it against the new /api/reports contract.
export default function ReportsPage() {
  return (
    <div className="page">
      <h1>Reports</h1>
      <p className="muted">
        The v2 reports UI (hours by task, presets, group-by-user for admins)
        lands next. The backend is ready at /api/reports.
      </p>
    </div>
  );
}
