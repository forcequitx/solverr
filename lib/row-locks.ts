import type { Prisma } from "@/generated/prisma/client";

/** Row locks held until the transaction ends, so concurrent changes to one record take turns.
    Lock order: user, then merchant, then invoice, then quotes or transfers, to avoid deadlocks. */

/** Serializes business creation for one login, so a repeated first submit cannot create two businesses. */
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

export async function lockInvoice(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
}

/** Locks the invoice only when it belongs to `merchantId`, so a request naming another business's invoice holds no lock on it. */
export async function lockMerchantInvoice(tx: Prisma.TransactionClient, invoiceId: string, merchantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND merchant_id = ${merchantId} FOR UPDATE`;
}

export async function lockMerchant(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
}

/** Waits for an uncommitted change to the merchant row (payout wallet, privacy) and holds it until the transaction ends;
    readers holding it run side by side. */
export async function lockMerchantShared(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR SHARE`;
}
