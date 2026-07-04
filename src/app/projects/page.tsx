// v1 held projects as first-class entities; v2 (see docs/PLAN.md) drops the
// concept entirely in favor of freeform tasks. This page is a compile-safe
// stub left for T6, which removes the route and its nav link for good.
export default function ProjectsPage() {
  return (
    <div className="page">
      <h1>Projects</h1>
      <p className="muted">
        Projects were removed in the v2 data model (tasks + time only). This
        route is slated for removal.
      </p>
    </div>
  );
}
