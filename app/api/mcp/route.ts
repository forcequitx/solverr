import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticateMerchant } from "@/lib/api/auth";
import { MAX_BODY_BYTES, readBodyText } from "@/lib/api/body";
import { errorResponse } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { errorMessage, logger } from "@/lib/logger";
import { buildMcpServer } from "@/lib/mcp/server";

const log = logger.child({ module: "mcp" });

/** JSON-RPC messages in a POST body: each message of a batch counts, so one request cannot run up to 100 tools for one rate-limit unit.
    A body over the size limit is refused here, before the rest of it is read. */
async function messageCount(request: Request): Promise<number> {
  if (request.method !== "POST") return 1;
  const raw = await readBodyText(request.clone());
  try {
    const body: unknown = JSON.parse(raw);
    return Array.isArray(body) ? Math.max(body.length, 1) : 1;
  } catch {
    return 1;
  }
}

/** Remote MCP server (Streamable HTTP). The merchant's API key is the bearer token. */
async function serve(request: Request): Promise<Response> {
  try {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`mcp:${apiKeyId}`, 120, 60_000, await messageCount(request));
    const handler = createMcpHandler(() => buildMcpServer(merchant, mode), {
      legacy: "stateless",
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => log.error({ error: errorMessage(error) }, "MCP request failed"),
    });
    return await handler.fetch(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
