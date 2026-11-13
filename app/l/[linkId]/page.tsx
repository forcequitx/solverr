import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaymentLinkForm } from "@/components/checkout/payment-link-form";
import { getDb } from "@/lib/db";
import { en } from "@/lib/i18n/messages/en";
import { logoUrl } from "@/lib/merchants/logo";

export const metadata: Metadata = { title: en.meta.payTitle, robots: { index: false } };

export default async function PaymentLinkPage({ params, searchParams }: PageProps<"/l/[linkId]">) {
  const { linkId } = await params;
  const { embed } = await searchParams;
  const link = await getDb().paymentLink.findUnique({ where: { id: linkId }, include: { merchant: { select: { name: true, logoId: true } } } });
  if (!link || !link.active) notFound();

  return (
    <PaymentLinkForm
      linkId={link.id}
      merchantName={link.merchant.name}
      logoUrl={logoUrl(link.merchant.logoId)}
      amount={link.amount ? link.amount.toFixed(2) : null}
      currency={link.currency}
      testMode={link.mode === "test"}
      embedded={embed === "1"}
    />
  );
}
