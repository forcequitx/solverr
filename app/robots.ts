import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

/** Built once per deployment: APP_URL is fixed at build time, as in the root layout's `metadataBase`. */
export const dynamic = "force-static";

/** Private pages (dashboard, setup, checkout, receipts) stay crawlable so crawlers see their own noindex,
    which a robots.txt block would hide; only the JSON API, which has no pages, is closed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: new URL("/sitemap.xml", getEnv().APP_URL).toString() };
}
