import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyableValue } from "@/components/dashboard/detail/copyable-value";
import { DetailList, DetailRow } from "@/components/dashboard/detail/detail-list";
import { Disclosure } from "@/components/dashboard/detail/disclosure";
import { FactCard } from "@/components/dashboard/detail/fact-card";
import { StatusTimeline } from "@/components/dashboard/detail/status-timeline";
import { PageHeader } from "@/components/dashboard/page-header";
import { PaymentAttempt } from "@/components/dashboard/payments/payment-attempt";
import { paymentTimeline } from "@/components/dashboard/payments/payment-timeline";
import { RefundControl } from "@/components/dashboard/payments/refund-control";
import { WebhookDeliveries } from "@/components/dashboard/payments/webhook-deliveries";
import { TransferStatusBadge } from "@/components/dashboard/transfers/transfer-status";
import { Badge, InvoiceStatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { Icon } from "@/components/ui/icon";
import { requireMerchant } from "@/lib/auth/session";
import { getChain } from "@/lib/chains/registry";
import { formatCurrencyAmount, formatUtcDateTime } from "@/lib/format";
import { OPEN_STATUSES } from "@/lib/invoices/statuses";
import { paymentDetail } from "@/lib/merchants/payment-stats";
import { formatBaseUnits } from "@/lib/money";
import { caseKindLabel } from "@/lib/support/case-kinds";
import { checkRefund } from "@/lib/transfers/transfers";

export default async function PaymentDetailPage({ params }: PageProps<"/dashboard/payments/[id]">) {
  const { id } = await params;
  const { merchant, mode, role } = await requireMerchant();
  const editable = role !== "viewer";
  const detail = await paymentDetail(merchant.id, mode, id);
  if (!detail) notFound();
  const { invoice, deliveries, refunds } = detail;
  const metadata = (invoice.metadata ?? {}) as Record<string, string>;
  const chosen = invoice.quotes.find((quote) => quote.id === invoice.paidQuoteId) ?? invoice.quotes[0];
  const settlementChain = getChain(invoice.destinationChain)?.name ?? invoice.destinationChain;
  const flags = [invoice.late ? "Paid late" : null, invoice.extraPayment ? "Extra payment received" : null].filter(Boolean).join(" · ");
  const statusLine = invoice.paidAt ? `Paid ${formatUtcDateTime(invoice.paidAt)}` : OPEN_STATUSES.has(invoice.status) ? `Expires ${formatUtcDateTime(invoice.expiresAt)}` : `Updated ${formatUtcDateTime(invoice.updatedAt)}`;

  return (
    <>
      <PageHeader
        title={invoice.orderId ? `Order ${invoice.orderId}` : (invoice.description ?? invoice.id)}
        description={<CopyableValue value={invoice.id} ariaLabel="Copy payment ID" />}
        action={
          <>
            <ButtonLink href={`/pay/${invoice.id}`} target="_blank" rel="noreferrer" variant="secondary" size="sm">
              Checkout page
              <Icon name="arrowUpRight" className="size-4" />
            </ButtonLink>
            {invoice.status === "paid" && editable ? <RefundControl check={checkRefund(invoice, merchant.payoutChain, refunds)} invoiceId={invoice.id} /> : null}
          </>
        }
      />

      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <FactCard icon="payments" tint="blue" label="Amount" value={formatCurrencyAmount(invoice.amount.toFixed(2), invoice.currency)} sub={`Created ${formatUtcDateTime(invoice.createdAt)}`} />
          <FactCard
            icon="wallet"
            tint="lime"
            label={invoice.status === "paid" ? "You received" : "You would receive"}
            value={`${formatBaseUnits(BigInt(invoice.amountOutBase), invoice.destinationDecimals)} ${invoice.destinationSymbol}`}
            sub={`On ${settlementChain}`}
          />
          <FactCard
            icon="coins"
            tint="blue"
            label={invoice.status === "paid" ? "Paid with" : "Chosen coin"}
            value={chosen ? `${chosen.amountInFormatted} ${chosen.originSymbol}` : "None yet"}
            sub={chosen ? `On ${getChain(chosen.originChain)?.name ?? chosen.originChain}` : "The customer has not chosen a coin."}
          />
          <FactCard icon="activity" tint="lime" label="Status" value={<InvoiceStatusBadge status={invoice.status} />} sub={flags || statusLine} />
        </div>

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <CardHeading icon="activity" title="Timeline" description="Each step of this payment, from checkout to your wallet." />
            <StatusTimeline steps={paymentTimeline(invoice, invoice.quotes)} label="Payment timeline" />
          </Card>

          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <CardHeading icon="payments" tint="blue" title="Details" description="What the checkout was created with." />
            <DetailList>
              <DetailRow label="Payment ID">
                <CopyableValue value={invoice.id} ariaLabel="Copy payment ID" />
              </DetailRow>
              {invoice.orderId ? (
                <DetailRow label="Order ID">
                  <CopyableValue value={invoice.orderId} ariaLabel="Copy order ID" />
                </DetailRow>
              ) : null}
              {invoice.description ? (
                <DetailRow label="Description">
                  <span className="min-w-0 break-words">{invoice.description}</span>
                </DetailRow>
              ) : null}
              {invoice.customerEmail ? (
                <DetailRow label="Customer email">
                  <CopyableValue value={invoice.customerEmail} ariaLabel="Copy customer email" />
                </DetailRow>
              ) : null}
              <DetailRow label="Coin you receive">
                {invoice.destinationSymbol} on {settlementChain}
              </DetailRow>
              <DetailRow label="Created">{formatUtcDateTime(invoice.createdAt)}</DetailRow>
              <DetailRow label={invoice.status === "expired" ? "Expired" : "Checkout expiry"}>{formatUtcDateTime(invoice.expiresAt)}</DetailRow>
              {invoice.paidAt ? <DetailRow label="Paid">{formatUtcDateTime(invoice.paidAt)}</DetailRow> : null}
              {invoice.late || invoice.extraPayment ? (
                <DetailRow label="Notes">
                  <span className="flex flex-wrap gap-1.5 sm:justify-end">
                    {invoice.late ? <Badge tone="warn">Paid late</Badge> : null}
                    {invoice.extraPayment ? <Badge tone="warn">Extra payment</Badge> : null}
                  </span>
                </DetailRow>
              ) : null}
            </DetailList>
            {Object.keys(metadata).length > 0 ? (
              <Disclosure summary={`Metadata (${Object.keys(metadata).length})`}>
                <pre className="whitespace-pre-wrap break-all rounded-control bg-surface-2 p-3 font-mono text-meta">{JSON.stringify(metadata, null, 2)}</pre>
              </Disclosure>
            ) : null}
          </Card>
        </div>

        {refunds.length > 0 ? (
          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <CardHeading icon="transfers" tint="blue" title="Refunds" description="Refunds of this payment, newest first. Open one to send or cancel it." />
            <ul className="flex flex-col gap-2">
              {refunds.map((refund) => (
                <li key={refund.id}>
                  <Link
                    href={`/dashboard/transfers/${refund.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {refund.amount} {invoice.destinationSymbol}
                      </span>
                      <span className="block text-meta text-muted">{formatUtcDateTime(refund.createdAt)}</span>
                    </span>
                    <TransferStatusBadge status={refund.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
          <CardHeading
            icon="coins"
            title="Payment attempts"
            description={
              invoice.quotes.length === 0
                ? "Each coin and chain the customer chooses shows here."
                : invoice.quotes.length === 1
                  ? "1 coin and chain the customer chose."
                  : `${invoice.quotes.length} coins and chains the customer chose, newest first.`
            }
          />
          {invoice.quotes.length === 0 ? (
            <p className="rounded-[16px] border border-dashed border-line px-6 py-8 text-center text-sm text-muted">The customer has not chosen a coin yet.</p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {invoice.quotes.map((quote) => (
                <PaymentAttempt key={quote.id} quote={quote} invoice={invoice} refund={editable ? checkRefund(invoice, merchant.payoutChain, refunds, { paymentId: quote.id }) : null} />
              ))}
            </ul>
          )}
        </Card>

        <WebhookDeliveries deliveries={deliveries} />

        {invoice.supportCases.length > 0 ? (
          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <CardHeading icon="lifebuoy" tint="blue" title="Support cases" description="Problems found with this payment." />
            <ul className="flex flex-col divide-y divide-line text-sm">
              {invoice.supportCases.map((supportCase) => (
                <li key={supportCase.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <span className="font-medium">{caseKindLabel(supportCase.kind)}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <CopyableValue value={supportCase.id} ariaLabel="Copy case ID" />
                    <Badge tone={supportCase.status === "open" ? "warn" : "success"}>{supportCase.status === "open" ? "Open" : "Resolved"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
