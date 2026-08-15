// Shared CSV field encoding for the two exports (/api/reports/csv and
// /api/invoices/[id]/csv), which each carried their own identical copy of
// the RFC 4180 quoting helper.
//
// Beyond quoting, this neutralizes spreadsheet formula injection (security
// review 2026-08-15). Excel, LibreOffice, and Google Sheets treat a cell
// whose text begins with = + - @ (or a leading tab/CR) as a formula, and
// RFC 4180 quoting does NOT prevent that — the quotes are stripped during
// import, then the content is evaluated.
//
// That matters here because the values are attacker-reachable and the
// audience is privileged: any member can name a task with arbitrary text
// (normalizeTaskName accepts 2-120 free-form characters) or write 2000
// characters of task details, and with GOOGLE_AUTO_PROVISION_DOMAINS enabled
// a member's display name comes from their own Google profile. Those land in
// the task / task_details / member / engineer columns of files the founder
// opens in a spreadsheet to do invoicing.
//
// The fix is OWASP's: prefix the offending cell with an apostrophe, which
// spreadsheets consume as "treat the rest as literal text". Numeric columns
// are written with String(...) and never routed through here, so no hours
// value can be mangled by the leading-minus rule.

const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;
const NEEDS_QUOTING_RE = /[",\n\r]/;

/** Encodes one CSV field: formula-neutralized, then RFC 4180 quoted if needed. */
export function csvField(value: string): string {
  const safe = FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
  if (NEEDS_QUOTING_RE.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Joins pre-encoded fields into a row. */
export function csvRow(fields: string[]): string {
  return fields.join(",");
}
