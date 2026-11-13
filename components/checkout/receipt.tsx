"use client";

import { Logo, LogoMark } from "@/components/brand/logo";
import type { Payment } from "@/components/checkout/checkout-api";
import { CopyButton } from "@/components/checkout/copy-button";
import { DeckBox, DeckDetails, DeckIcon, StackedCards } from "@/components/checkout/stacked-cards";
import { TransactionLinks } from "@/components/checkout/transaction-links";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";
import { getChain } from "@/lib/chains/registry";
import { formatCurrencyAmount, formatShortAmount } from "@/lib/format";
import { format, formatNodes } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";
import { OPEN_STATUSES } from "@/lib/invoices/statuses";
import { isTestDepositAddress } from "@/lib/oneclick/test-deposit";
import type { CheckoutState } from "@/lib/payments/checkout-state";

/** Characters kept at the end of a shortened deposit address. */
const ADDRESS_TAIL = 10;

/** What NEAR Intents sent back from a completed payment (an overpayment or unused price buffer) as "amount symbol", or null. */
export function returnedAmount(payment: Payment): string | null {
  return payment.refunded_amount && Number(payment.refunded_amount) > 0 ? `${payment.refunded_amount} ${payment.coin.symbol}` : null;
}

/** The receipt as stacked cards, plus a "check it yourself" card for a completed payment, side by side when there is room;
    `page` is the standalone receipt page, `checkout` shows it inside the payment page. */
export function Receipt({ state, variant }: { state: CheckoutState; variant: "page" | "checkout" }) {
  const m = messages.receipt;

  const page = variant === "page";
  const Heading = page ? "h1" : "h2";
  const Subheading = page ? "h2" : "h3";
  const paid = state.status === "paid";
  /** The coin paid, the payment proof and the explorer check belong to a completed payment only. */
  const payment = paid ? state.payment : null;
  const hasTransactions = !!payment && payment.origin_transactions.length + payment.destination_transactions.length > 0;
  const settlementChain = getChain(state.settlement.blockchain)?.name ?? state.settlement.blockchain;
  /** A numeric UTC time renders identically on the server and in the browser. */
  const paidAt = state.paid_at ? `${new Date(state.paid_at).toISOString().slice(0, 16).replace("T", " ")} UTC` : null;
  const icon: IconName = paid ? "check" : OPEN_STATUSES.has(state.status) ? "clock" : "alert";
  const returned = payment ? returnedAmount(payment) : null;

  return (
    <div className="@container mx-auto flex w-full max-w-[900px] flex-col gap-4">
      <div className={`grid items-start gap-[22px] ${payment ? "@4xl:grid-cols-2" : ""}`}>
        <StackedCards
          tone={paid ? "success" : "muted"}
          front={
            <>
              {page ? <Logo /> : null}
              <DeckIcon icon={icon} />
              <div className="min-w-0">
                <p className="text-meta text-muted">{m.eyebrow}</p>
                <Heading className="font-heading text-[23px] leading-tight font-bold tracking-[-0.025em] text-balance [overflow-wrap:anywhere] @[25rem]:text-[26px]">
                  {state.merchant.name}
                </Heading>
              </div>
              {paid ? null : <InvoiceStatusBadge status={state.status} label={m.status[state.status]} />}
              <p className="font-heading text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {formatShortAmount(state.amount)} <span className="text-[15px] font-medium tracking-normal text-muted">{state.currency}</span>
              </p>
            </>
          }
        >
          {paid ? null : <p className="rounded-2xl bg-surface px-4 py-3 text-meta text-muted">{m.notComplete}</p>}
          <DeckDetails
            rows={[
              { label: m.amount, value: formatCurrencyAmount(state.amount, state.currency) },
              ...(state.order_id ? [{ label: m.order, value: state.order_id }] : []),
              ...(payment ? [{ label: m.paidWith, value: format(m.coinOnChain, { amount: payment.amount_in, symbol: payment.coin.symbol, chain: payment.coin.chain_name }) }] : []),
              ...(returned ? [{ label: m.returned, value: returned }] : []),
              ...(paid ? [{ label: m.merchantReceived, value: format(m.coinOnChain, { amount: state.settlement.amount, symbol: state.settlement.symbol, chain: settlementChain }) }] : []),
              ...(paidAt ? [{ label: m.paidAt, value: paidAt }] : []),
              { label: m.paymentId, value: <span className="font-mono">{state.id}</span> },
            ]}
          />
          {paid || !page ? null : (
            <ButtonLink href={`/pay/${state.id}`} variant="secondary">
              {messages.common.openPaymentPage}
            </ButtonLink>
          )}
        </StackedCards>

        {/** A simulated demo payment went through no network, so there is nothing to look up on an explorer. */}
        {payment && !isTestDepositAddress(payment.deposit_address) ? (
          <StackedCards
            tone="accent"
            align="start"
            front={
              <>
                <div className="flex items-center gap-3">
                  <DeckIcon icon="shield" size="sm" />
                  <Subheading className="font-heading text-xl leading-tight font-bold tracking-[-0.02em]">{m.checkHeading}</Subheading>
                </div>
                <p className="text-meta text-muted">
                  {payment.confidential
                    ? m.privateText
                    : formatNodes(m.explorerText, {
                        explorer: (
                          <a href="https://explorer.near-intents.org" target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                            {m.explorerLink}
                          </a>
                        ),
                      })}
                </p>
              </>
            }
          >
            {hasTransactions ? (
              <DeckBox>
                <TransactionLinks payment={payment} messages={messages.paymentStatus} />
              </DeckBox>
            ) : null}
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pr-1.5 pl-3.5 text-[13.5px] @max-[25rem]:flex-col @max-[25rem]:items-stretch @max-[25rem]:gap-2 @max-[25rem]:p-2 @max-[25rem]:pt-3">
              {/** One line whose middle gives way to an ellipsis, keeping the last characters; in a narrow card and on paper the whole
                  address wraps, with the copy button under it on screen. */}
              <span
                title={payment.deposit_address}
                className="flex min-w-0 flex-1 font-mono whitespace-nowrap @max-[25rem]:block @max-[25rem]:px-1.5 @max-[25rem]:break-all @max-[25rem]:whitespace-normal print:block print:break-all print:whitespace-normal"
              >
                <span className="truncate @max-[25rem]:overflow-visible @max-[25rem]:whitespace-normal print:overflow-visible print:whitespace-normal">{payment.deposit_address.slice(0, -ADDRESS_TAIL)}</span>
                <span className="shrink-0">{payment.deposit_address.slice(-ADDRESS_TAIL)}</span>
              </span>
              <CopyButton value={payment.deposit_address} label={m.copy} aria-label={m.copyAddress} className="shrink-0 print:hidden @max-[25rem]:w-full" />
            </div>
            <div className="print:hidden">
              <DeckBox>
              <details>
                <summary className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control font-heading text-sm font-semibold text-accent-text ${FOCUS_RING} pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden`}>
                  <Icon name="flip" className="size-[15px]" />
                  {m.showProof}
                </summary>
                <dl className="mt-2.5 flex flex-col gap-[3px] text-[13px]">
                  <dt className="text-muted">{m.correlationId}</dt>
                  <dd className="font-mono leading-normal wrap-anywhere">{payment.correlation_id}</dd>
                  <dt className="mt-2 text-muted">{m.quoteSignature}</dt>
                  <dd className="font-mono leading-normal wrap-anywhere">{payment.quote_signature}</dd>
                </dl>
              </details>
              </DeckBox>
            </div>
          </StackedCards>
        ) : null}
      </div>

      {page ? (
        <p className="text-center text-meta text-muted">
          <LogoMark className="mr-1.5 inline size-4 align-[-3px]" />
          {m.footer}
        </p>
      ) : null}
    </div>
  );
}
