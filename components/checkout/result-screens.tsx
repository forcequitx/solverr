"use client";

import { useEffect, useRef, useState } from "react";
import type { Payment } from "@/components/checkout/checkout-api";
import { postToEmbedder } from "@/components/checkout/embed-escape";
import { helpLinkProps } from "@/components/checkout/help-link";
import { Receipt, returnedAmount } from "@/components/checkout/receipt";
import { DECK_BUTTON, DeckBox, DeckDetails, StackedNotice, StackedResult } from "@/components/checkout/stacked-cards";
import { TransactionLinks } from "@/components/checkout/transaction-links";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatAmount, formatShortAmount } from "@/lib/format";
import { format, formatNodes } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";
import type { CheckoutState } from "@/lib/payments/checkout-state";

/** The customer's transaction links in a white box inside a stacked result's tray. */
function TransactionBox({ payment }: { payment: Payment }) {
  if (payment.origin_transactions.length + payment.destination_transactions.length === 0) return null;
  return (
    <DeckBox>
      <TransactionLinks payment={payment} messages={messages.paymentStatus} />
    </DeckBox>
  );
}

/** Paid invoice with "Back to the merchant" (the only way out; nothing redirects on a timer) and "View receipt", which replaces
    this screen in the page with a Back button rather than opening over it. */
export function PaidScreen({ state, embedded }: { state: CheckoutState; embedded: boolean }) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const toggled = useRef(false);
  const redirect = !embedded ? state.redirect_url : null;
  const m = messages.results;
  const r = messages.receipt;
  const payment = state.payment;
  const returned = payment ? returnedAmount(payment) : null;

  const { id, mode, status, amount, currency, order_id } = state;
  useEffect(() => {
    if (!embedded) return;
    const receipt_url = new URL(`/receipt/${id}`, window.location.origin).toString();
    postToEmbedder({ type: "paid", invoice: { id, object: "invoice", mode, status, amount, currency, order_id, receipt_url } });
  }, [embedded, id, mode, status, amount, currency, order_id]);

  /** Focus moves to the button that switches back: Back on the receipt, View receipt on return. */
  useEffect(() => {
    if (!toggled.current) return;
    screen.current?.querySelector<HTMLElement>("[data-receipt-toggle]")?.focus();
  }, [receiptOpen]);

  const toggleReceipt = (open: boolean) => {
    toggled.current = true;
    setReceiptOpen(open);
  };

  if (receiptOpen) {
    return (
      <div ref={screen} className="flex flex-col gap-4">
        <Button data-receipt-toggle variant="secondary" className="self-start" onClick={() => toggleReceipt(false)}>
          <Icon name="arrowLeft" className="size-4" />
          {m.backFromReceipt}
        </Button>
        <Receipt state={state} variant="checkout" />
      </div>
    );
  }

  return (
    <div ref={screen}>
      <StackedResult
        tone="success"
        icon="check"
        title={m.paidTitle}
        lead={
          <>
            <p className="text-[15px] leading-relaxed text-pretty">{format(m.paidBody, { amount: formatAmount(state.amount), currency: state.currency })}</p>
            {/** Someone who paid twice learns that the second payment is known and how to get it back. */}
            {state.extra_payment ? <StackedNotice tone="warn">{m.extraPaymentNotice}</StackedNotice> : null}
          </>
        }
        actions={
          <>
            {redirect ? (
              /** A long merchant name wraps onto a second line instead of being cut off. */
              <ButtonLink href={redirect} size="lg" className="col-span-2 h-auto! min-h-14 rounded-[18px]! py-3 text-[16.5px]! leading-snug whitespace-normal!">
                <span className="min-w-0 text-center text-balance [overflow-wrap:anywhere]">{format(m.backTo, { merchant: state.merchant.name })}</span>
              </ButtonLink>
            ) : null}
            <ButtonLink
              data-receipt-toggle
              href={`/receipt/${state.id}`}
              target={embedded ? "_blank" : undefined}
              rel="noreferrer"
              variant="secondary"
              size="lg"
              className={`col-span-2 border-[1.5px]! ${DECK_BUTTON}`}
              onClick={(event) => {
                /** A modified click still opens the receipt page in a new tab. */
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                toggleReceipt(true);
              }}
            >
              <Icon name="ticket" className="size-4" />
              {m.viewReceipt}
            </ButtonLink>
          </>
        }
      >
        <DeckDetails
          rows={[
            { label: r.amount, value: `${formatShortAmount(state.amount)} ${state.currency}` },
            ...(payment ? [{ label: r.paidWith, value: `${payment.amount_in} ${payment.coin.symbol}` }] : []),
            ...(returned ? [{ label: r.returned, value: returned }] : []),
            { label: r.paymentId, value: <span className="font-mono">{state.id}</span> },
          ]}
        />
        {payment ? <TransactionBox payment={payment} /> : null}
      </StackedResult>
    </div>
  );
}

/** The payment reached its address and is being converted; the band's status track shows the steps, so the tray holds only the note and links. */
export function InProgressScreen({ payment, status }: { payment: Payment | null; status: "detected" | "processing" }) {
  const m = messages.results;
  return (
    <StackedResult
      tone="accent"
      icon="activity"
      title={status === "detected" ? m.detectedTitle : m.convertingTitle}
      lead={
        <p className="inline-flex items-start gap-2 rounded-full bg-success-bg px-3.5 py-1.5 font-heading text-sm leading-snug font-semibold text-success">
          <Icon name="check" className="mt-0.5 size-4 shrink-0" />
          {m.detectedNotice}
        </p>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{m.inProgressNote}</p>
      {payment ? <TransactionBox payment={payment} /> : null}
    </StackedResult>
  );
}

export function UnderpaidScreen({ payment }: { payment: Payment | null }) {
  const m = messages.results;
  const symbol = payment?.coin.symbol ?? "";
  const needed = payment?.amount_in ?? "";
  /** The deposited amount is unknown until NEAR Intents reports it. */
  const sent = payment?.deposited_amount
    ? format(m.underpaidSent, { sent: payment.deposited_amount, needed, symbol })
    : format(m.underpaidSentUnknown, { needed, symbol });
  return (
    <StackedResult
      tone="warn"
      icon="alert"
      title={m.underpaidTitle}
      lead={
        <p className="text-[15px] leading-relaxed text-pretty [overflow-wrap:anywhere]">
          {sent} {m.underpaidRefund}
        </p>
      }
    >
      <p className="rounded-2xl bg-surface px-4 py-3.5 text-center font-heading text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">{payment?.refund_address}</p>
      <p className="flex items-start gap-2.5 text-sm text-info">
        <Icon name="info" className="mt-0.5 size-4 shrink-0" />
        {m.underpaidRetry}
      </p>
    </StackedResult>
  );
}

export function RefundedScreen({ payment, onRetry, canRetry }: { payment: Payment | null; onRetry: () => void; canRetry: boolean }) {
  const m = messages.results;
  return (
    <StackedResult
      tone="info"
      icon="undo"
      title={m.refundedTitle}
      lead={
        <p className="text-[15px] leading-relaxed text-pretty [overflow-wrap:anywhere]">
          {formatNodes(m.refundedBody, {
            amount: payment?.refunded_amount ? `${payment.refunded_amount} ${payment.coin.symbol}` : m.yourPayment,
            address: <b className="font-semibold">{payment?.refund_address}</b>,
          })}
          {payment?.refund_fee ? ` ${format(m.refundFee, { fee: payment.refund_fee, symbol: payment.coin.symbol })}` : ""}
        </p>
      }
      actions={
        canRetry ? (
          <Button size="lg" className={`col-span-2 ${DECK_BUTTON}`} onClick={onRetry}>
            {m.tryAgain}
          </Button>
        ) : null
      }
    >
      {payment ? <TransactionBox payment={payment} /> : null}
    </StackedResult>
  );
}

export function FailedScreen({ invoiceId, embedded, onRetry, canRetry }: { invoiceId: string; embedded: boolean; onRetry: () => void; canRetry: boolean }) {
  const m = messages.results;
  return (
    <StackedResult
      tone="danger"
      icon="alert"
      title={m.failedTitle}
      actions={
        <>
          <ButtonLink
            {...helpLinkProps(invoiceId, embedded)}
            variant="secondary"
            size="lg"
            className={`${DECK_BUTTON} border-[1.5px]! ${canRetry ? "" : "col-span-2"}`}
          >
            {m.getHelp}
          </ButtonLink>
          {canRetry ? (
            <Button size="lg" className={DECK_BUTTON} onClick={onRetry}>
              {m.tryAgain}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="text-center text-[15px] leading-relaxed">{m.failedBody}</p>
    </StackedResult>
  );
}

/** Shown when the open payment was created outside this page (such as by someone else with the link): its coin, network and refund
    address are spelled out, and it can be paid only after the customer confirms. */
export function ChangedPaymentScreen({ payment, onConfirm }: { payment: Payment; onConfirm: () => void }) {
  const m = messages.checkout;
  return (
    <StackedResult
      tone="warn"
      icon="alert"
      title={m.changedTitle}
      alert
      lead={
        <p className="text-[15px] leading-relaxed text-pretty [overflow-wrap:anywhere]">
          {formatNodes(m.changedBody, {
            coin: <b className="font-semibold">{payment.coin.symbol}</b>,
            chain: <b className="font-semibold">{payment.coin.chain_name}</b>,
            address: <span className="font-mono text-meta font-semibold [overflow-wrap:anywhere]">{payment.refund_address}</span>,
          })}
        </p>
      }
      actions={
        <Button variant="secondary" size="lg" className={`col-span-2 border-[1.5px]! ${DECK_BUTTON}`} onClick={onConfirm}>
          {m.changedConfirm}
        </Button>
      }
    />
  );
}

export function ExpiredScreen({ merchant }: { merchant: string }) {
  const m = messages.results;
  return (
    <StackedResult
      tone="muted"
      icon="clock"
      title={m.expiredTitle}
      lead={<p className="text-[15px] leading-relaxed text-pretty">{format(m.expiredBody, { merchant })}</p>}
    />
  );
}
