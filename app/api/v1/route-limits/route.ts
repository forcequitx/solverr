import { z } from "zod";
import { MINUTE_CACHE_HEADERS } from "@/lib/api/cache";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { serializeRouteLimit } from "@/lib/payments/route-limits";

/** Unknown query parameters (cache busters, tracking tags) are ignored, as on the other read endpoints. */
const querySchema = z.object({
  destination_asset: z.string().min(1).max(200).optional(),
  origin_asset: z.string().min(1).max(200).optional(),
});

/** What NEAR Intents currently accepts on each route into the settlement coins merchants use, as last measured by the worker. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await rateLimit(`route-limits:${clientIp(request)}`, 60, 60_000);
    const { destination_asset, origin_asset } = parseInput(querySchema, Object.fromEntries(new URL(request.url).searchParams));
    const rows = await getDb().routeLimit.findMany({
      where: { ...(destination_asset ? { destinationAsset: destination_asset } : {}), ...(origin_asset ? { originAsset: origin_asset } : {}) },
      orderBy: [{ destinationAsset: "asc" }, { originAsset: "asc" }],
    });
    return Response.json({ object: "list", data: rows.map(serializeRouteLimit) }, { headers: MINUTE_CACHE_HEADERS });
  });
}
