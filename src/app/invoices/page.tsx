"use client";

// Admin-only invoices tab (v2.8): "Current week (uninvoiced)" live preview
// of the next sweep, then the periods list (newest first) with an inline
// accordion — one period open at a time — showing a per-member summary
// table and a task-detail sub-table (not included in the CSV export).
// Members are redirected to `/`, same pattern as /dashboard and /team.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getInvoicePeriod,
  invoiceCsvUrl,
  listInvoices,
  setInvoicePeriodLocked,
} from "@/lib/api";
import { formatShortDate, hoursLabel, parseLocalDate, pluralCount } from "@/lib/format";
import type { CurrentUninvoiced, InvoicePeriodDetail, InvoicePeriodSummary } from "@/lib/types";
import { useSession } from "@/components/SessionContext";

/**
 * "Sun Jul 12, 11:59 PM Pacific" from a UTC instant, always rendered in
 * America/Los_Angeles regardless of the viewer's own timezone (per plan).
 * Built from formatToParts rather than a single Intl call so the exact
 * "weekday month day, time Pacific" shape (no comma after the weekday) is
 * guaranteed rather than left to locale defaults.
 */
function formatNextCutoff(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get(
    "dayPeriod"
  )} Pacific`;
}

/** "Week ending Jul 5" from a period's 'YYYY-MM-DD' label (the Sunday). */
function periodLabel(label: string): string {
  return `Week ending ${formatShortDate(parseLocalDate(label))}`;
}

export default function InvoicesPage() {
  const { user } = useSession();
  const router = useRouter();

  const [periods, setPeriods] = useState<InvoicePeriodSummary[]>([]);
  const [current, setCurrent] = useState<CurrentUninvoiced | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoicePeriodDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lockBusyId, setLockBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "admin") router.replace("/");
  }, [user, router]);

  const load = useCallback(async () => {
    const result = await listInvoices();
    setPeriods(result.periods);
    setCurrent(result.current);
    setLastBackup(result.lastBackup);
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") return;
    setError(null);
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : "failed to load invoices"))
      .finally(() => setReady(true));
  }, [user, load]);

  async function loadDetail(periodId: string) {
    setDetailLoading(true);
    try {
      const d = await getInvoicePeriod(periodId);
      setDetail(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to load period detail");
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleExpand(period: InvoicePeriodSummary) {
    if (expandedId === period.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(period.id);
    setDetail(null);
    loadDetail(period.id);
  }

  async function handleToggleLock(period: InvoicePeriodSummary) {
    if (period.locked) {
      const weekEndingDate = formatShortDate(parseLocalDate(period.label));
      if (
        !confirm(
          `Unlock week ending ${weekEndingDate}? Members will be able to edit these entries until you relock.`
        )
      ) {
        return;
      }
    }
    setLockBusyId(period.id);
    setError(null);
    try {
      await setInvoicePeriodLocked(period.id, !period.locked);
      await load();
      if (expandedId === period.id) await loadDetail(period.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to update lock state");
    } finally {
      setLockBusyId(null);
    }
  }

  if (!user || user.role !== "admin") return null;

  const detailTotalHours = detail ? detail.members.reduce((sum, m) => sum + m.hours, 0) : 0;

  return (
    <div className="page">
      <h1>Invoices</h1>
      {error && <p className="error-text">{error}</p>}

      {ready && current && (
        <section className="section">
          <h2>Current week (uninvoiced)</h2>
          <div className="stat-row">
            <div className="stat-card">
              <div className="stat-value">{hoursLabel(current.totalHours * 3600)}</div>
              <div className="stat-label">Uninvoiced hours so far</div>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th className="num">Hours</th>
                </tr>
              </thead>
              <tbody>
                {current.members.map((m) => (
                  <tr key={m.id}>
                    <td className="strong">{m.name}</td>
                    <td className="num">{hoursLabel(m.hours * 3600)}</td>
                  </tr>
                ))}
                {current.members.length === 0 && (
                  <tr>
                    <td colSpan={2} className="muted">
                      No uninvoiced entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{hoursLabel(current.totalHours * 3600)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small">
            Next cutoff: {formatNextCutoff(current.nextCutoffAt)}
            {" · "}
            {lastBackup ? `Last backup: ${formatShortDate(parseLocalDate(lastBackup))}` : "No backups yet"}
          </p>
        </section>
      )}

      {ready && (
        <section className="section">
          <h2>
            Periods <span className="table-count">{pluralCount(periods.length, "period")}</span>
          </h2>
          <div className="invoice-periods">
            {periods.length === 0 && <p className="muted">No invoice periods yet.</p>}
            {periods.map((period) => {
              const isOpen = expandedId === period.id;
              return (
                <div className="invoice-period" key={period.id}>
                  <div
                    className="invoice-period-row"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleExpand(period)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(period);
                      }
                    }}
                  >
                    <span className="invoice-period-label strong">{periodLabel(period.label)}</span>
                    <span className="muted">{hoursLabel(period.totalHours * 3600)}</span>
                    <span className="muted">{pluralCount(period.memberCount, "member")}</span>
                    {!period.locked && (
                      <span className="status-badge status-badge-submitted">Unlocked</span>
                    )}
                    <span className="invoice-period-actions" onClick={(e) => e.stopPropagation()}>
                      <a className="btn" href={invoiceCsvUrl(period.id)}>
                        Export CSV
                      </a>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={lockBusyId === period.id}
                        onClick={() => handleToggleLock(period)}
                      >
                        {period.locked ? "Unlock" : "Relock"}
                      </button>
                    </span>
                  </div>
                  {isOpen && (
                    <div className="invoice-period-detail">
                      {detailLoading && !detail && <p className="muted">Loading…</p>}
                      {detail && detail.period.id === period.id && (
                        <>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Member</th>
                                  <th className="num">Hours</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.members.map((m) => (
                                  <tr key={m.id}>
                                    <td>{m.name}</td>
                                    <td className="num">{hoursLabel(m.hours * 3600)}</td>
                                  </tr>
                                ))}
                                {detail.members.length === 0 && (
                                  <tr>
                                    <td colSpan={2} className="muted">
                                      No entries in this period.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <td>Total</td>
                                  <td className="num">{hoursLabel(detailTotalHours * 3600)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Member</th>
                                  <th>Task</th>
                                  <th className="num">Hours</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.taskDetail.map((row, i) => (
                                  <tr key={i}>
                                    <td>{row.member}</td>
                                    <td className="mono">{row.task}</td>
                                    <td className="num">{hoursLabel(row.hours * 3600)}</td>
                                  </tr>
                                ))}
                                {detail.taskDetail.length === 0 && (
                                  <tr>
                                    <td colSpan={3} className="muted">
                                      No entries in this period.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <p className="muted small">Detail is not included in the CSV export.</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
