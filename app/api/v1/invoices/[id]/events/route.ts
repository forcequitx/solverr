import { ApiError, handleRoute } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { subscribeCheckout } from "@/lib/payments/checkout-events";
import { markCheckoutSeen } from "@/lib/payments/checkout-state";

/** A comment line keeps proxies from closing a quiet stream and keeps the worker polling as for an open checkout. */
const HEARTBEAT_MS = 20_000;
/** Streams end after this long and the browser reconnects, so an unnoticed disconnect cannot keep one open past `maxDuration`. */
const STREAM_MAX_MS = 4 * 60_000;

/** Seconds a stream's function may run on Vercel: its longest stream plus a margin, within every plan's limit. */
export const maxDuration = 300;
/** How long the browser waits before it reconnects a stream that ended. */
const RETRY_MS = 3_000;
const CHANGE_EVENT = "event: change\ndata: \n\n";
/** Streams started per client IP, network and invoice in a fixed STREAM_MAX_MS window, counted in Postgres across instances; no stream outlives
    the window, so at most twice these are open at once. A refused checkout polls `/status` and opens its stream again later. */
const MAX_STREAM_STARTS = { ip: 30, network: 100, invoice: 20 } as const;

/** Public: a Server-Sent Events stream that sends `change` when the checkout state changes; the page then reads it from `/status`. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/events">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    await rateLimit(`events-ip:${clientIp(request)}`, MAX_STREAM_STARTS.ip, STREAM_MAX_MS);
    await rateLimit(`events-net:${clientNetwork(request)}`, MAX_STREAM_STARTS.network, STREAM_MAX_MS);
    const invoice = await getDb().invoice.findUnique({ where: { id }, select: { id: true } });
    if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
    await rateLimit(`events-invoice:${id}`, MAX_STREAM_STARTS.invoice, STREAM_MAX_MS);

    const encoder = new TextEncoder();
    let push: (text: string) => void = () => {};
    let end: () => void = () => {};
    const unsubscribe = await subscribeCheckout(id, { onChange: () => push(CHANGE_EVENT), onLost: () => end() });
    if (!unsubscribe) throw new ApiError(503, "upstream_unavailable", "Live updates are not available right now.");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const heartbeat = setInterval(() => {
          push(": ping\n\n");
          markCheckoutSeen(id).catch(() => {});
        }, HEARTBEAT_MS);
        const lifetime = setTimeout(() => end(), STREAM_MAX_MS);
        end = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          request.signal.removeEventListener("abort", end);
          try {
            controller.close();
          } catch {
            /** The browser already closed the stream. */
          }
        };
        push = (text) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            end();
          }
        };
        request.signal.addEventListener("abort", end);
        push(`retry: ${RETRY_MS}\n\n`);
      },
      cancel() {
        end();
      },
    });

    /** `no-transform` keeps proxies from compressing this response, so each event reaches the browser as soon as it is sent. */
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
    });
  });
}

/** Next.js would answer HEAD with GET and drop the body, opening a stream nothing reads that runs until it ends, so HEAD is refused. */
export function HEAD() {
  return Response.json(
    { error: { type: "invalid_request", message: "Open this stream with GET." } },
    { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
  );
}
