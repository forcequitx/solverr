import { PAYMENT_RESPONSE_HEADER, decodePaymentResponseHeader, readHeader } from "solverr-x402";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import type { AgentWallet } from "./agent-wallet.js";
import { PaymentError, errorSummary } from "./errors.js";
import { isHostAllowed, type SpendingLimits } from "./limits.js";
import { assertFetchAllowed, pinnedDispatcher } from "./url-guard.js";

export interface McpServerOptions {
  name: string;
  version: string;
  /** `set_limits` can lower limits and narrow the allow list, but never go above these. */
  ceiling: SpendingLimits;
}

/** Longest response body returned to the model, in characters. */
const MAX_BODY_CHARS = 20_000;
const TEXT_CONTENT_TYPE = /^(text\/|application\/(json|xml|[\w.+-]+\+(json|xml))|application\/x-www-form-urlencoded)/i;

const json = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

function failure(error: unknown) {
  if (error instanceof PaymentError) {
    const invoice = error.invoiceId ? { invoice_id: error.invoiceId } : {};
    return json({ error: { code: error.code, message: error.message, funds_sent: error.fundsSent, ...invoice } }, true);
  }
  return json({ error: { code: "request_failed", message: errorSummary(error), funds_sent: false } }, true);
}

/** Reads a text body up to the size limit; a body that fails to arrive is described instead, so the status and receipt still reach the model. */
async function readBody(response: Response): Promise<{ body: string; truncated: boolean }> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType && !TEXT_CONTENT_TYPE.test(contentType)) {
      await response.body?.cancel();
      return { body: `[${contentType} body not shown]`, truncated: false };
    }
    if (!response.body) return { body: "", truncated: false };
    /** Read in chunks and stopped past the limit, so a huge or endless body is never held in memory. */
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      text += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (text.length > MAX_BODY_CHARS) {
        await reader.cancel();
        return { body: text.slice(0, MAX_BODY_CHARS), truncated: true };
      }
      if (done) return { body: text, truncated: false };
    }
  } catch (error) {
    return { body: `[body could not be read: ${errorSummary(error, 120)}]`, truncated: false };
  }
}

/** Whether every host matched by `pattern` is also matched by the `ceiling` allow list. */
function isCoveredBy(pattern: string, ceiling: readonly string[]): boolean {
  const normalized = pattern.trim().toLowerCase();
  if (ceiling.includes(normalized)) return true;
  const wildcards = ceiling.filter((entry) => entry.startsWith("*."));
  return isHostAllowed(normalized.replace(/^\*\./, ""), wildcards);
}

/** Checks `requested` against the ceiling configured at startup and returns the merged limits. */
export function limitsWithinCeiling(current: SpendingLimits, requested: Partial<SpendingLimits>, ceiling: SpendingLimits): SpendingLimits {
  const next = { ...current, ...requested };
  if (next.perPaymentUsd > ceiling.perPaymentUsd) throw new Error(`per_payment_usd cannot be above $${ceiling.perPaymentUsd}, the limit set when the server started.`);
  if (next.dailyUsd > ceiling.dailyUsd) throw new Error(`daily_usd cannot be above $${ceiling.dailyUsd}, the limit set when the server started.`);
  if (!next.allow.every((pattern) => isCoveredBy(pattern, ceiling.allow))) {
    throw new Error(`allow can only contain hosts from the startup allow list: ${ceiling.allow.join(", ")}.`);
  }
  return next;
}

function buildServer(agent: AgentWallet, options: McpServerOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });

  server.registerTool(
    "pay_url",
    {
      title: "Fetch a URL, paying if needed",
      description:
        "Fetches a URL on a host in the allow list. If the site answers 402 Payment Required with a Solverr invoice, pays it from the agent wallet within the spending limits, then fetches again. Returns the HTTP status, the payment receipt and the response body; a redirect is returned with its location instead of being followed. If the result has payment_unused true, invoice_id is paid but the site answered with an error and did not use the payment: calling pay_url again with the same method and URL sends that payment again instead of paying a new invoice. If an error says funds_sent is true, money left the wallet for invoice_id: follow the error message before calling pay_url for the same request again.",
      inputSchema: z.object({
        url: z.url({ protocol: /^https?$/ }).describe("The http or https URL to fetch."),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
        headers: z.record(z.string(), z.string()).optional().describe("Extra request headers."),
        body: z.string().optional().describe("Request body for POST, PUT or PATCH."),
      }),
    },
    async ({ url, method, headers, body }) => {
      try {
        const target = new URL(url);
        const dispatcher = pinnedDispatcher(await assertFetchAllowed(target, agent.limits().allow));
        let response: Response;
        let text: string;
        let truncated: boolean;
        try {
          /** Redirects are returned, not followed, and connections go only to the checked addresses, so every URL the model reaches passes the checks above. */
          response = await agent.fetch(target, { method, headers, body, redirect: "manual", dispatcher });
          ({ body: text, truncated } = await readBody(response));
        } finally {
          await dispatcher?.close();
        }
        const location = response.headers.get("location");
        const unusedInvoice = response.status >= 400 ? agent.unusedInvoice(target, method) : undefined;
        return json({
          status: response.status,
          ...(location ? { location } : {}),
          content_type: response.headers.get("content-type") || null,
          payment: readHeader(response.headers.get(PAYMENT_RESPONSE_HEADER), decodePaymentResponseHeader) ?? null,
          ...(unusedInvoice ? { invoice_id: unusedInvoice, payment_unused: true } : {}),
          body: text,
          body_truncated: truncated,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_balances",
    { title: "Wallet balances", description: "Shows the agent wallet's balances of the coins it can pay with, on NEAR and Base." },
    async () => {
      try {
        return json(await agent.balances());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_spending",
    { title: "Spending and limits", description: "Shows the spending limits, the amount spent in the last 24 hours, and recent payments." },
    async () => {
      try {
        return json(await agent.spending());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "set_limits",
    {
      title: "Change spending limits",
      description: "Lowers the per-payment or daily USD limit, or narrows the list of hosts the agent may pay. Limits cannot be raised above the values the server was started with.",
      inputSchema: z.object({
        per_payment_usd: z.number().min(0).optional(),
        daily_usd: z.number().min(0).optional(),
        allow: z.array(z.string().min(1)).optional().describe("Hosts the agent may request and pay, such as api.example.com or *.example.com."),
      }),
    },
    async ({ per_payment_usd, daily_usd, allow }) => {
      try {
        const current = agent.limits();
        const requested: Partial<SpendingLimits> = {
          ...(per_payment_usd !== undefined ? { perPaymentUsd: per_payment_usd } : {}),
          ...(daily_usd !== undefined ? { dailyUsd: daily_usd } : {}),
          ...(allow !== undefined ? { allow } : {}),
        };
        return json({ limits: agent.setLimits(limitsWithinCeiling(current, requested, options.ceiling)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

/** Serves the agent wallet as an MCP server over stdin and stdout. */
export function serveAgentMcp(agent: AgentWallet, options: McpServerOptions): StdioServerHandle {
  return serveStdio(() => buildServer(agent, options), { onerror: (error) => process.stderr.write(`[solverr-agent] ${errorSummary(error)}\n`) });
}
