import type { InvoiceStatus } from "@/generated/prisma/client";

/** Unpaid statuses of a payment that may still complete; any other unpaid status ended without a receipt. */
export const OPEN_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["created", "awaiting_payment", "detected", "processing"]);

/** Statuses that are only reached after the full deposit arrived; an underpaid deposit is not among them. */
export const ARRIVED_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["detected", "processing", "paid"]);

/** Statuses in which nothing has arrived yet and the payer can still get a payment address and pay. */
export const PAYABLE_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["created", "awaiting_payment"]);
