import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWallet } from "../src/agent-wallet.js";
import { PaymentError } from "../src/errors.js";
import { serveAgentMcp } from "../src/mcp-server.js";
import { assertFetchAllowed, pinnedDispatcher } from "../src/url-guard.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Tool handlers the server registered, by name; the MCP server and stdio transport are replaced so no process streams are used. */
const tools = vi.hoisted(() => new Map<string, ToolHandler>());

vi.mock("@modelcontextprotocol/server", () => ({
  McpServer: class {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      tools.set(name, handler);
    }
  },
}));
vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: (createServer: () => unknown) => {
    createServer();
    return {};
  },
}));
vi.mock("../src/url-guard.js", () => ({ assertFetchAllowed: vi.fn(async () => []), pinnedDispatcher: vi.fn(() => undefined) }));

const URL_TEXT = "https://api.example.com/data";
const limits = { perPaymentUsd: 1, dailyUsd: 5, allow: ["api.example.com"] };

function serveWith(response: Response, unusedInvoice?: string) {
  const agent = {
    fetch: vi.fn(async () => response),
    balances: vi.fn(),
    spending: vi.fn(),
    limits: vi.fn(() => limits),
    setLimits: vi.fn(),
    unusedInvoice: vi.fn(() => unusedInvoice),
  };
  serveAgentMcp(agent as unknown as AgentWallet, { name: "test", version: "0", ceiling: limits });
  return agent;
}

async function payUrl(input: Record<string, unknown>) {
  const result = await tools.get("pay_url")!(input);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  tools.clear();
  vi.clearAllMocks();
});

describe("pay_url request guard", () => {
  it("checks the target against the allow list and fetches it through the pinned addresses without following redirects", async () => {
    const dispatcher = { close: vi.fn(async () => undefined) };
    vi.mocked(assertFetchAllowed).mockResolvedValueOnce(["93.184.216.34"]);
    vi.mocked(pinnedDispatcher).mockReturnValueOnce(dispatcher as unknown as ReturnType<typeof pinnedDispatcher>);
    const agent = serveWith(new Response("ok", { status: 200 }));
    await payUrl({ url: URL_TEXT, method: "GET" });
    expect(assertFetchAllowed).toHaveBeenCalledWith(new URL(URL_TEXT), limits.allow);
    expect(pinnedDispatcher).toHaveBeenCalledWith(["93.184.216.34"]);
    expect(agent.fetch).toHaveBeenCalledWith(new URL(URL_TEXT), expect.objectContaining({ method: "GET", redirect: "manual", dispatcher }));
    expect(dispatcher.close).toHaveBeenCalledOnce();
  });

  it("refuses a host the guard rejects without fetching it", async () => {
    vi.mocked(assertFetchAllowed).mockRejectedValueOnce(new PaymentError("host_not_allowed", "Requests to evil.example are not allowed."));
    const agent = serveWith(new Response("ok", { status: 200 }));
    const result = await tools.get("pay_url")!({ url: "https://evil.example/data", method: "GET" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ error: { code: "host_not_allowed", message: "Requests to evil.example are not allowed.", funds_sent: false } });
    expect(agent.fetch).not.toHaveBeenCalled();
  });

  it("returns a redirect with its location instead of following it", async () => {
    const location = "http://169.254.169.254/latest/meta-data";
    const agent = serveWith(new Response(null, { status: 302, headers: { location } }));
    const result = await payUrl({ url: URL_TEXT, method: "GET" });
    expect(result).toMatchObject({ status: 302, location, body: "" });
    expect(agent.fetch).toHaveBeenCalledOnce();
    expect(assertFetchAllowed).toHaveBeenCalledOnce();
    expect(assertFetchAllowed).toHaveBeenCalledWith(new URL(URL_TEXT), limits.allow);
  });
});

describe("pay_url", () => {
  it("names the paid invoice the site left unused when the response is an error", async () => {
    const agent = serveWith(new Response("gone", { status: 404 }), "inv_1");
    const result = await payUrl({ url: URL_TEXT, method: "POST" });
    expect(result).toMatchObject({ status: 404, invoice_id: "inv_1", payment_unused: true, body: "gone" });
    expect(agent.unusedInvoice).toHaveBeenCalledWith(new URL(URL_TEXT), "POST");
  });

  it("leaves out invoice_id when no paid invoice is kept", async () => {
    serveWith(new Response("gone", { status: 404 }));
    const result = await payUrl({ url: URL_TEXT, method: "GET" });
    expect(result).not.toHaveProperty("invoice_id");
    expect(result).not.toHaveProperty("payment_unused");
  });

  it("does not look for an unused payment after a success", async () => {
    const agent = serveWith(new Response("ok", { status: 200 }), "inv_1");
    const result = await payUrl({ url: URL_TEXT, method: "GET" });
    expect(result).toMatchObject({ status: 200, body: "ok" });
    expect(result).not.toHaveProperty("payment_unused");
    expect(agent.unusedInvoice).not.toHaveBeenCalled();
  });
});
