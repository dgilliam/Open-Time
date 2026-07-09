import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/SessionContext";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: {
    template: "Open-Time — %s",
    default: "Open-Time — Time entry", // the root page is the time-entry view
  },
  description: "Team time tracking for RepoScout",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
