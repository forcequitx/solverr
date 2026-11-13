import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Receipt } from "@/components/checkout/receipt";
import { en } from "@/lib/i18n/messages/en";
import { getCheckoutState } from "@/lib/payments/checkout-state";

export const metadata: Metadata = { title: en.meta.receiptTitle, robots: { index: false } };

export default async function ReceiptPage({ params }: PageProps<"/receipt/[invoiceId]">) {
  const { invoiceId } = await params;
  /** Viewing a receipt is not an open checkout, so the worker keeps its normal polling pace. */
  const state = await getCheckoutState(invoiceId, { markSeen: false });
  if (!state) notFound();

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <main className="flex-1 bg-surface-2 px-3 pt-5 pb-8 sm:px-6 sm:py-12">
        <Receipt state={state} variant="page" />
      </main>
    </div>
  );
}
