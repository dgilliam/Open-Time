import type { Metadata } from "next";

export const metadata: Metadata = { title: "Timesheet" };

export default function TimesheetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
