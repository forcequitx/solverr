import type { Invoice, PaymentEvent, Quote } from "@/generated/prisma/client";
import { TransactionLinks } from "@/components/checkout/transaction-links";
import { CopyableValue } from "@/components/dashboard/detail/copyable-value";
import { DetailList, DetailRow } from "@/components/dashboard/detail/detail-list";
import { Disclosure } from "@/components/dashboard/detail/disclosure";
import { RefundControl } from "@/components/dashboard/payments/refund-control";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CoinIcon } from "@/components/ui/coin-icon";
import { formatUtcDateTime } from "@/lib/format";
import { oneClickStatusLabel } from "@/lib/oneclick/status-labels";
import { serializePayment } from "@/lib/payments/serialize";
import type { RefundCheck } from "@/lib/transfers/transfers";

const STATUS_TONES: Partial<Record<Quote["oneclickStatus"], BadgeTone>> = { SUCCESS: "success", INCOMPLETE_DEPOSIT: "warn", REFUNDED: "warn", FAILED: "danger" };

/** Labels for the transactions of one payment, as the merchant sees them. */
const TRANSACTION_LABELS = { yourPayment: "Customer payment on {chain}", merchantSettlement: "Delivered to your payout wallet" };

/** One payment attempt: the coin and chain, its addresses, transactions, 1Click status changes, and for an extra payment the Refund
    button or why it cannot be refunded; `refund` is the payment's `checkRefund` result, null for viewers. */
export function PaymentAttempt({ quote, invoice, refund }: { quote: Quote & { events: PaymentEvent[] }; invoice: Invoice; refund: RefundCheck<unknown> | null }) {
  const payment = serializePayment(quote, quote.events.at(-1), invoice.destinationChain);
  const extra = invoice.status === "paid" && quote.oneclickStatus === "SUCCESS" && quote.id !== invoice.paidQuoteId;

  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-[16px] border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CoinIcon symbol={quote.originSymbol} className="size-9 text-xs" />
          <div className="min-w-0">
            <p className="truncate text-body font-semibold">
              {quote.amountInFormatted} {quote.originSymbol}
            </p>
            <p className="truncate text-meta text-muted">
              {payment.coin.chain_name} · {formatUtcDateTime(quote.createdAt)}
            </p>
          </div>
        </div>
        <Badge tone={quote.state === "retired" ? "muted" : (STATUS_TONES[quote.oneclickStatus] ?? "accent")}>
          {/** A retired attempt with no deposit: its deadline passed, a newer address replaced it, its invoice ended, or payout settings changed. */}
          {quote.state === "retired" && quote.oneclickStatus === "PENDING_DEPOSIT" ? "Expired" : oneClickStatusLabel(quote.oneclickStatus)}
        </Badge>
      </div>

      <DetailList>
        <DetailRow label="Deposit address">
          <CopyableValue value={quote.depositAddress} ariaLabel="Copy deposit address" />
        </DetailRow>
        {quote.depositMemo ? (
          <DetailRow label="Deposit memo">
            <CopyableValue value={quote.depositMemo} ariaLabel="Copy deposit memo" />
          </DetailRow>
        ) : null}
        <DetailRow label="Refunds go to">
          <CopyableValue value={quote.refundTo} ariaLabel="Copy refund address" />
        </DetailRow>
      </DetailList>

      <TransactionLinks payment={payment} messages={TRANSACTION_LABELS} />

      {extra ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-warn-bg px-3 py-2.5">
          <p className="text-meta text-warn">This payment arrived after the amount due was already paid.</p>
          {refund ? <RefundControl check={refund} invoiceId={invoice.id} paymentId={quote.id} label="Refund this extra payment" /> : null}
        </div>
      ) : null}

      {quote.events.length > 0 ? (
        <Disclosure summary={`Status updates (${quote.events.length})`}>
          <ol className="flex flex-col gap-1.5 text-meta">
            {quote.events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3">
                <span>{oneClickStatusLabel(event.oneclickStatus)}</span>
                <span className="tabular-nums text-muted">{formatUtcDateTime(event.receivedAt)}</span>
              </li>
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </li>
  );
}
