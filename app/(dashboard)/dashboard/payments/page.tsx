import type { Metadata } from "next";
import { InvoiceStatus } from "@/generated/prisma/client";
import { PageHeader } from "@/components/dashboard/page-header";
import { paymentListRow } from "@/components/dashboard/payments/list-row";
import { PaymentList } from "@/components/dashboard/payments/payment-list";
import { PaymentsSummary } from "@/components/dashboard/payments/payments-summary";
import { requireMerchant } from "@/lib/auth/session";
import { paymentRows } from "@/lib/merchants/payment-stats";
import { paymentPeriods } from "@/lib/merchants/stats";

const PAYMENT_ROWS = 500;

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/dashboard/payments">) {
  const { merchant, mode } = await requireMerchant();
  const { status } = await searchParams;
  const [periods, rows] = await Promise.all([paymentPeriods(merchant.id, mode), paymentRows(merchant.id, mode, { take: PAYMENT_ROWS })]);

  return (
    <>
      <PageHeader title="Payments" description="Every payment, the coin it was paid with, and its current status. Open one for its full timeline." />
      <div className="flex flex-col gap-4 sm:gap-5">
        <PaymentsSummary periods={periods} />
        <PaymentList
          rows={rows.map(paymentListRow)}
          title="All payments"
          pageSize={10}
          limit={PAYMENT_ROWS}
          exportable
          initialStatus={typeof status === "string" && Object.hasOwn(InvoiceStatus, status) ? status : ""}
        />
      </div>
    </>
  );
}
