import { ApiError, handleRoute } from "@/lib/api/errors";
import { clientIp, rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";

/** A logo id is new for every upload, so its image never changes: browsers and Vercel's CDN may keep it for a year. */
const IMMUTABLE = "public, max-age=31536000, immutable";
const CDN_IMMUTABLE = "public, s-maxage=31536000, immutable";

/** Public: a business logo as shown on its checkout and payment-link pages. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/logos/[id]">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    await rateLimit(`logo-ip:${clientIp(request)}`, 300, 60_000);
    const logo = await getDb().merchantLogo.findUnique({ where: { id }, select: { image: true } });
    if (!logo) throw new ApiError(404, "not_found", "No logo with this id.", "id");
    /** Stored logos are always re-encoded WebP; the policy keeps the response from ever running as a page. */
    return new Response(new Uint8Array(logo.image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": IMMUTABLE,
        "CDN-Cache-Control": CDN_IMMUTABLE,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  });
}
