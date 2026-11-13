import { llmsFullText } from "@/lib/docs/llms-source";
import { getEnv } from "@/lib/env";

/** Built once per deployment: APP_URL is fixed at build time, as in the root layout's `metadataBase`. */
export const dynamic = "force-static";

/** The text of every docs page in one file, the companion of /llms.txt. */
export async function GET() {
  return new Response(await llmsFullText(getEnv().APP_URL), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
