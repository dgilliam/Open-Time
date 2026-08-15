import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy (security review 2026-08-15).
//
// 'unsafe-inline' on script-src is not an oversight: the App Router emits
// inline bootstrap and RSC-payload <script> tags, and the only way to drop it
// is a nonce issued per request from middleware. This app has no middleware
// (route protection is server-side in each handler), so adding one purely for
// CSP nonces was more machinery than the threat justifies — there is no
// user-generated HTML anywhere in this app, and React escapes every value it
// renders. Revisit if that ever stops being true.
//
// 'unsafe-eval' is dev-only — react-refresh needs it for HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Inline style attributes are used throughout the components (heatmap
  // cells, grid sizing), which style-src 'unsafe-inline' covers.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // Same-origin /api only. In dev this also needs the HMR websocket.
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The actual clickjacking control. X-Frame-Options below repeats it for
  // anything that predates CSP frame-ancestors.
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Railway terminates TLS for every deployment (DEPLOY.md), so this is safe
  // to assert in production. Omitted in dev, where `next dev` is plain http
  // on localhost. No `preload` — that's a one-way door for the domain.
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

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
  async headers() {
    return [
      {
        // Everything, including /api — the CSV and JSON responses benefit
        // from nosniff, and frame-ancestors on an API response costs nothing.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
