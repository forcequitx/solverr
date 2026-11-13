import { z } from "zod";
import type { Invoice, Merchant, Mode, PaymentLink } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { Currency } from "@/lib/fx";
import { newId } from "@/lib/ids";
import { createInvoice } from "@/lib/invoices/create";
import { currencySchema, fiatAmountSchema, redirectUrlSchema } from "@/lib/invoices/schema";

export const createPaymentLinkSchema = z.strictObject({
  title: z.string({ error: "title is required." }).trim().min(1, "title is required.").max(120, "title can be at most 120 characters."),
  amount: fiatAmountSchema().optional(),
  currency: currencySchema,
  redirect_url: redirectUrlSchema.optional(),
});

/** Body of the public "pay this link" call; `amount` is used only by customer-chosen (tip) links and ignored for fixed-amount ones. */
export const payLinkSchema = z.strictObject({ amount: fiatAmountSchema().optional() });

export function serializePaymentLink(link: PaymentLink) {
  return {
    id: link.id,
    object: "payment_link",
    mode: link.mode,
    url: new URL(`/l/${link.id}`, getEnv().APP_URL).toString(),
    title: link.title,
    amount: link.amount ? link.amount.toFixed(2) : null,
    currency: link.currency,
    redirect_url: link.redirectUrl,
    active: link.active,
    created_at: link.createdAt.toISOString(),
  };
}

export function createPaymentLink(merchant: Merchant, mode: Mode, input: z.infer<typeof createPaymentLinkSchema>): Promise<PaymentLink> {
  return getDb().paymentLink.create({
    data: { id: newId("lnk"), merchantId: merchant.id, mode, title: input.title, amount: input.amount ?? null, currency: input.currency, redirectUrl: input.redirect_url ?? null },
  });
}

/** The business website as a return address, only when it is an http or https URL. */
function websiteRedirect(website: string | null): string | undefined {
  return website && redirectUrlSchema.safeParse(website).success ? website : undefined;
}

/** Creates a fresh invoice for one visit to a payment link. */
export async function invoiceForLink(linkId: string, chosenAmount?: string): Promise<Invoice> {
  const link = await getDb().paymentLink.findUnique({ where: { id: linkId }, include: { merchant: true } });
  if (!link || !link.active) throw new ApiError(404, "not_found", "This payment link does not exist or was turned off.");
  const amount = link.amount ? link.amount.toFixed(2) : chosenAmount;
  if (!amount) throw new ApiError(400, "invalid_request", "Enter the amount you want to pay.", "amount");

  /** After paying, the customer is sent back to the link's return address, or else to the business website. */
  const redirectUrl = link.redirectUrl ?? websiteRedirect(link.merchant.website);
  return createInvoice(
    link.merchant,
    link.mode,
    { amount, currency: link.currency as Currency, description: link.title, ...(redirectUrl ? { redirect_url: redirectUrl } : {}) },
    { paymentLinkId: link.id },
  );
}
