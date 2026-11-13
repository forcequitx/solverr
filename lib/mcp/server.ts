import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { InvoiceStatus, type Merchant, type Mode } from "@/generated/prisma/client";
import { ApiError, toApiError } from "@/lib/api/errors";
import { CHAINS } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { createInvoice } from "@/lib/invoices/create";
import { createInvoiceSchema } from "@/lib/invoices/schema";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { integrationSnippet, SNIPPET_KINDS } from "@/lib/mcp/snippets";
import { createPaymentLink, createPaymentLinkSchema, serializePaymentLink } from "@/lib/payment-links/links";
import { serializeTransfer } from "@/lib/transfers/serialize";
import { createRefund, createRefundSchema } from "@/lib/transfers/transfers";

/** Largest number of array elements and object members one tool call's arguments may hold. */
const MAX_TOOL_INPUT_ELEMENTS = 200;

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** Runs a tool; a failure returns the same safe message the REST API gives, never internal details. */
async function safely(run: () => Promise<unknown>) {
  try {
    return result(await run());
  } catch (error) {
    const { type, message } = toApiError(error);
    return { ...result({ error: { type, message } }), isError: true };
  }
}

/** MCP tools acting as the merchant whose API key authenticated the request. */
export function buildMcpServer(merchant: Merchant, mode: Mode): McpServer {
  /** Tool arguments are small (an invoice has at most 20 metadata keys); a bound keeps huge payloads from blocking the server. */
  const server = new McpServer({ name: "solverr", version: "0.1.0" }, { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS });
  const appUrl = getEnv().APP_URL;

  server.registerTool(
    "create_invoice",
    {
      description: `Create an invoice and return its checkout_url. Send the customer to that page; they can pay with coins on ${CHAINS.length} chains.`,
      inputSchema: createInvoiceSchema,
    },
    (input) => safely(async () => serializeInvoice(await createInvoice(merchant, mode, input))),
  );

  server.registerTool(
    "get_invoice",
    { description: "Get one invoice and its payment status.", inputSchema: z.strictObject({ id: z.string().min(1) }) },
    ({ id }) =>
      safely(async () => {
        const invoice = await getDb().invoice.findFirst({ where: { id, merchantId: merchant.id, mode } });
        if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
        return serializeInvoice(invoice);
      }),
  );

  server.registerTool(
    "list_payments",
    {
      description: "List recent invoices, newest first. Pass status to list only invoices in that status.",
      inputSchema: z.strictObject({ limit: z.number().int().min(1).max(50).default(10), status: z.enum(InvoiceStatus).optional() }),
    },
    ({ limit, status }) =>
      safely(async () => {
        const invoices = await getDb().invoice.findMany({ where: { merchantId: merchant.id, mode, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: limit });
        return invoices.map(serializeInvoice);
      }),
  );

  server.registerTool(
    "create_payment_link",
    {
      description: "Create a shareable payment link. Leave amount empty for a tip link where the customer chooses the amount.",
      inputSchema: createPaymentLinkSchema,
    },
    (input) => safely(async () => serializePaymentLink(await createPaymentLink(merchant, mode, input))),
  );

  server.registerTool(
    "get_integration_snippet",
    {
      description: "Get ready-to-paste code to add Solverr checkout to a website: html (script button), react, node (server SDK) or webhook (Next.js handler).",
      inputSchema: z.strictObject({ kind: z.enum(SNIPPET_KINDS), link_id: z.string().optional().describe("Payment link id for html/react; the newest active link is used when omitted.") }),
    },
    ({ kind, link_id }) =>
      safely(async () => {
        const link = await getDb().paymentLink.findFirst({
          where: { merchantId: merchant.id, mode, active: true, ...(link_id ? { id: link_id } : {}) },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (link_id && !link) throw new ApiError(404, "not_found", "No active payment link with this id.", "link_id");
        if (!link && (kind === "html" || kind === "react")) {
          throw new ApiError(404, "not_found", "No active payment link. Create one with create_payment_link first.", "link_id");
        }
        return { kind, code: integrationSnippet(kind, appUrl, link?.id ?? "") };
      }),
  );

  server.registerTool(
    "create_refund",
    {
      description:
        "Create a pending refund for a paid invoice: the whole remaining amount, or `amount` in the coin the business receives. Pass `payment_id` to refund an extra payment instead of the one that paid the invoice. The business must approve it from its payout wallet at the returned sign_url.",
      inputSchema: createRefundSchema,
    },
    (input) => safely(async () => serializeTransfer(await createRefund(merchant, input))),
  );

  return server;
}
