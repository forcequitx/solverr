import type { CheckoutInvoice } from "./types.js";

export type CheckoutMessage = { type: "paid"; invoice: CheckoutInvoice } | { type: "close" };

/** Reads a checkout message, accepting only messages posted by the checkout frame on the app origin. */
export function readCheckoutMessage(event: MessageEvent, origin: string, frame: Window | null): CheckoutMessage | undefined {
  if (event.origin !== origin || !frame || event.source !== frame) return undefined;
  const message: unknown = event.data;
  if (!message || typeof message !== "object") return undefined;
  const { source, type, invoice } = message as { source?: unknown; type?: unknown; invoice?: { id?: unknown } };
  if (source !== "solverr") return undefined;
  if (type === "close") return { type: "close" };
  if (type === "paid" && invoice && typeof invoice.id === "string") return { type: "paid", invoice: invoice as CheckoutInvoice };
  return undefined;
}
