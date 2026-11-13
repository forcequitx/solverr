import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

/** Sent on every response. Wallet sign-in opens popups that must keep a reference to this window. */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

/** Checkout and payment-link pages are embedded in merchant sites, so only they may be framed. */
const EMBEDDABLE = ["/pay/:path*", "/l/:path*"];

/** Keyless endpoints a custom checkout calls from the browser: no cookies or keys, so any origin may read them (per-IP limits apply). */
const PUBLIC_API = [
  "/api/v1/tokens",
  "/api/v1/route-limits",
  "/api/v1/invoices/:id/:action(status|events|quote|estimate|deposit|email)",
  "/api/v1/payment-links/:id/invoices",
  "/api/v1/support-cases",
  "/api/v1/support-cases/lookup",
];
const PUBLIC_API_CORS = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type" },
  { key: "Access-Control-Expose-Headers", value: "Retry-After" },
  { key: "Access-Control-Max-Age", value: "86400" },
];

const nextConfig: NextConfig = {
  /** The browser tests run their own dev server in `.next-e2e`, so it never shares build files with a developer's `npm run dev`. */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /** For `npm run start` (scripts/dev.mjs); Vercel builds its own output and ignores it. */
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      ...EMBEDDABLE.map((source) => ({ source, headers: [{ key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'" }] })),
      ...PUBLIC_API.map((source) => ({ source, headers: PUBLIC_API_CORS })),
      {
        source: "/((?!pay/|l/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
  /** Loaded from node_modules at runtime instead of bundled, so the Sentry SDK's module hooks keep working. */
  serverExternalPackages: ["@sentry/node"],
  /** The API reference reads the spec by path at run time (lib/docs/openapi.ts), which file tracing cannot see. */
  outputFileTracingIncludes: { "/*": ["./openapi/openapi.yaml"] },
  agentRules: false,
  experimental: {
    /** The saved Turbopack dev cache makes open tabs reload forever after `next dev` restarts (vercel/next.js#100251). */
    turbopackFileSystemCacheForDev: false,
    /** `next dev` compiles `import()` targets (the wallet SDKs) on first use instead of with every page. */
    turbopackLazyDynamicImports: true,
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
