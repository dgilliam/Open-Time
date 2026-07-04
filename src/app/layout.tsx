import type { Metadata } from "next";
import "./globals.css";
import { UserProvider } from "@/components/UserContext";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Open-Time",
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
        <UserProvider>
          <div className="app-shell">
            <NavBar />
            <main className="app-main">{children}</main>
          </div>
        </UserProvider>
      </body>
    </html>
  );
}
