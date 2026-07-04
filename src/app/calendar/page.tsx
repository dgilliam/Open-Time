"use client";

// Month grid + GitHub-style heatmap. Admins get a person select (defaulting
// to themselves); members always see only their own data.

import { useEffect, useState } from "react";
import { getCalendar, listUsers } from "@/lib/api";
import { addDays, dateInputValue, startOfDay, startOfMonth, startOfWeek, toIso } from "@/lib/format";
import type { CalendarDay, User } from "@/lib/types";
import { Heatmap } from "@/components/Heatmap";
import { MonthCalendar } from "@/components/MonthCalendar";
import { useSession } from "@/components/SessionContext";
import { UserSelect } from "@/components/UserSelect";

function endOfMonthIso(month: Date): string {
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return toIso(new Date(nextMonth.getTime() - 1));
}

export default function CalendarPage() {
  const { user } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [monthData, setMonthData] = useState<CalendarDay[]>([]);
  const [heatmapDays, setHeatmapDays] = useState<{ date: Date; hours: number }[]>([]);
  const [heatmapReady, setHeatmapReady] = useState(false);

  // Seed the selected user once we know who's signed in, and load the admin
  // person list.
  useEffect(() => {
    if (!user) return;
    setSelectedUserId(user.id);
    if (user.role === "admin") {
      listUsers()
        .then(setUsers)
        .catch(() => setUsers([]));
    }
  }, [user]);

  // Month grid data: refetched whenever the viewed month or person changes.
  useEffect(() => {
    if (!selectedUserId) return;
    getCalendar({
      userId: selectedUserId,
      from: toIso(startOfMonth(month)),
      to: endOfMonthIso(month),
    })
      .then(setMonthData)
      .catch(() => setMonthData([]));
  }, [selectedUserId, month]);

  // Heatmap: one fetch for the last ~12 months, only refetched on person
  // change (not on month navigation).
  useEffect(() => {
    if (!selectedUserId) return;
    setHeatmapReady(false);
    const today = startOfDay(new Date());
    const rangeEnd = addDays(startOfWeek(today), 6);
    const rangeStart = startOfWeek(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1));
    getCalendar({ userId: selectedUserId, from: toIso(rangeStart), to: toIso(rangeEnd) })
      .then((data) => {
        const byDate = new Map(data.map((d) => [d.date, d.hours]));
        const days: { date: Date; hours: number }[] = [];
        for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
          days.push({ date: d, hours: byDate.get(dateInputValue(d)) ?? 0 });
        }
        setHeatmapDays(days);
      })
      .catch(() => setHeatmapDays([]))
      .finally(() => setHeatmapReady(true));
  }, [selectedUserId]);

  if (!user) return null;

  return (
    <div className="page">
      <h1>Calendar</h1>
      {user.role === "admin" && (
        <UserSelect users={users} value={selectedUserId} onChange={setSelectedUserId} />
      )}
      <MonthCalendar
        month={month}
        data={monthData}
        onPrev={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
        onNext={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
        onToday={() => setMonth(startOfMonth(new Date()))}
      />
      <section className="section">
        <h2>Activity</h2>
        {heatmapReady && <Heatmap days={heatmapDays} />}
      </section>
    </div>
  );
}
