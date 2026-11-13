import { llmsIndexText } from "@/lib/docs/llms-source";
import { getEnv } from "@/lib/env";

/** Built once per deployment: APP_URL is fixed at build time, as in the root layout's `metadataBase`. */
export const dynamic = "force-static";

/** Index of the docs for answer engines and AI agents, following https://llmstxt.org. */
export function GET() {
  return new Response(llmsIndexText(getEnv().APP_URL), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
