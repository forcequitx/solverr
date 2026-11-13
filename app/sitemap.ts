import type { MetadataRoute } from "next";
import { source } from "@/lib/docs/source";
import { getEnv } from "@/lib/env";

/** Built once per deployment: APP_URL is fixed at build time, as in the root layout's `metadataBase`. */
export const dynamic = "force-static";

const PUBLIC_PAGES = ["/", "/demo", "/help"];

/** Public pages and every docs page, generated API reference pages included; private pages stay out. No `lastModified`: no reliable edit date exists. */
export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = getEnv().APP_URL;
  return [...PUBLIC_PAGES, ...source.getPages().map((page) => page.url)].map((path) => ({ url: new URL(path, appUrl).toString() }));
}
