import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: {
    template: "Open-Time — %s",
    default: "Open-Time — Timer", // the root page is the Timer
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
        <div className="app-shell">
          <NavBar />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
