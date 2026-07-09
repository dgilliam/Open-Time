import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // v3.0: /timesheet and /calendar retired in favor of the merged Week page
  // at "/" (Week | Month toggle). Permanent redirects so old links/bookmarks
  // keep working.
  async redirects() {
    return [
      { source: "/timesheet", destination: "/", permanent: true },
      { source: "/calendar", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
