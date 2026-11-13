"use client";

import { QRCodeSVG } from "qrcode.react";
import { type ClipboardEvent, Fragment, useCallback, useId, useState } from "react";
import { groupsOfFour } from "@/components/checkout/address-groups";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi, CheckoutApiError, type Payment } from "@/components/checkout/checkout-api";
import { CopyButton } from "@/components/checkout/copy-button";
import { DECK_BUTTON, StackedNotice, StackedResult } from "@/components/checkout/stacked-cards";
import { ActionButton } from "@/components/ui/action-button";
import { ButtonLink } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { paymentUri } from "@/lib/chains/payment-uri";
import { getChain } from "@/lib/chains/registry";
import { format, formatNodes } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";
import { isTestDepositAddress } from "@/lib/oneclick/test-deposit";
import type { CheckoutCoin } from "@/lib/payments/coins";

const BIG_BUTTON = "h-[58px]! w-full rounded-[18px]! text-[17px]!";
const COPY_BUTTON = "h-14! w-full rounded-[18px]! text-[15px]!";

/** The address centered on two even lines, first and last 6 characters bold and the middle in groups of 4 or 5 for easy comparing;
    a half too long for its line wraps between groups, never inside one. */
function AddressBlock({ address }: { address: string }) {
  const groups = [address.slice(0, 6), ...groupsOfFour(address.slice(6, -6)), address.slice(-6)].filter(Boolean);
  const half = Math.ceil(groups.length / 2);
  const lines = [groups.slice(0, half), groups.slice(half)].filter((line) => line.length > 0);
  let position = 0;
  /** The spacing between groups and lines is only for reading; an address selected and copied by hand comes out whole. */
  const copyWhole = (event: ClipboardEvent<HTMLParagraphElement>) => {
    const selected = window.getSelection()?.toString();
    if (!selected) return;
    event.clipboardData.setData("text/plain", selected.replace(/\s+/g, ""));
    event.preventDefault();
  };
  return (
    <p onCopy={copyWhole} className="text-center font-mono text-[15.5px] leading-normal font-medium text-muted @[35rem]:text-base">
      {lines.map((line, lineIndex) => (
        <span key={lineIndex} className="block">
          {line.map((group) => {
            const index = position++;
            const end = index === 0 || index === groups.length - 1;
            return (
              <Fragment key={index}>
                <span className={`whitespace-nowrap ${end ? "font-bold text-fg" : ""}`}>{group}</span>{" "}
              </Fragment>
            );
          })}
        </span>
      ))}
    </p>
  );
}

/** The upright dashed tear line between the QR code and the address on wide screens, with a round notch cut into each edge. */
function TicketTear() {
  const notch = "absolute -left-[13px] size-6 rounded-full border border-line bg-surface";
  return (
    <div aria-hidden="true" className="relative col-start-2 row-start-1 my-4 hidden border-l-2 border-dashed border-line @[35rem]:block">
      <span className={`${notch} -top-[29px]`} />
      <span className={`${notch} -bottom-[29px]`} />
    </div>
  );
}

/** Manual payment: confirm the network, give a refund address, then send to the one-time address; `settlement` (the business's coin
    and chain, when the picker offers it) is suggested when this coin needs a larger payment. */
export function ManualPay({
  invoiceId,
  coin,
  settlement,
  payment,
  onQuoted,
}: {
  invoiceId: string;
  coin: CheckoutCoin;
  settlement?: { symbol: string; chainName: string };
  payment: Payment | null;
  onQuoted: (payment: Payment) => void;
}) {
  const [networkConfirmed, setNetworkConfirmed] = useState(false);
  const [refund, setRefund] = useState("");
  const [memoConfirmed, setMemoConfirmed] = useState(false);
  /** Narrow screens show the address or the QR code, one at a time; wide screens show both side by side. */
  const [addressView, setAddressView] = useState<"address" | "scan">("address");
  const tabsId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** The payment whose address ran out on this page; that address is no longer shown. Kept whole, because the server retires the
      address soon after and the notice, with its refund address for a new one, must stay until a new address arrives. */
  const [expired, setExpired] = useState<Payment | null>(null);
  const m = messages.manualPay;
  const errorMessage = error ? apiErrorText(error, messages, { coin, settlement }) : null;
  const refundRejected = error instanceof CheckoutApiError && error.param === "refund_address";

  const quoted = payment && payment.coin.asset_id === coin.assetId && payment.state === "active" ? payment : null;
  const lapsed = expired && expired.coin.asset_id === coin.assetId && (!quoted || quoted.deadline === expired.deadline) ? expired : null;
  /** The server checks the address format and its refusal shows under the field, so any non-empty address can be sent. */
  const refundReady = refund.trim().length > 0;

  const requestQuote = useCallback(
    async (refundAddress: string) => {
      setBusy(true);
      setError(null);
      try {
        onQuoted(await checkoutApi.quote(invoiceId, coin.assetId, refundAddress));
        setMemoConfirmed(false);
      } catch (cause) {
        setError(cause);
      } finally {
        setBusy(false);
      }
    },
    [invoiceId, coin.assetId, onQuoted],
  );

  if (lapsed) {
    return (
      <div className="flex flex-col gap-3.5">
        <StackedResult
          tone="muted"
          icon="clock"
          title={m.addressExpired}
          actions={
            <ActionButton size="lg" className={`col-span-2 ${DECK_BUTTON}`} pending={busy} pendingLabel={m.gettingAddress} onClick={() => requestQuote(lapsed.refund_address)}>
              {m.newAddress}
            </ActionButton>
          }
        />
        {errorMessage ? <StackedNotice tone="warn">{errorMessage}</StackedNotice> : null}
      </div>
    );
  }

  if (!quoted) {
    return (
      <div className="flex flex-col gap-3.5">
        <label className="flex cursor-pointer items-start gap-3 rounded-[18px] bg-surface-2 p-4 text-sm">
          <input type="checkbox" className="mt-px size-[18px] shrink-0 accent-[var(--accent)]" checked={networkConfirmed} onChange={(event) => setNetworkConfirmed(event.target.checked)} />
          <span>{formatNodes(m.networkConfirm, { symbol: <b>{coin.symbol}</b>, chain: <b>{coin.chainName}</b> })}</span>
        </label>

        <Field
          label={format(m.refundLabel, { chain: coin.chainName })}
          htmlFor="refund"
          error={refundRejected ? errorMessage : null}
          announce
          hint={coin.exchangeNeedsMemo ? format(m.refundHintMemo, { chain: coin.chainName }) : m.refundHint}
        >
          <Input
            id="refund"
            value={refund}
            onChange={(event) => setRefund(event.target.value)}
            placeholder={format(m.refundPlaceholder, { chain: coin.chainName })}
            autoComplete="off"
            spellCheck={false}
            className="h-[50px]! rounded-[14px]! border-[1.5px]!"
          />
        </Field>

        {errorMessage && !refundRejected ? <StackedNotice tone="warn">{errorMessage}</StackedNotice> : null}

        <ActionButton size="lg" className={BIG_BUTTON} disabled={!networkConfirmed || !refundReady} pending={busy} pendingLabel={m.gettingAddress} onClick={() => requestQuote(refund.trim())}>
          <Icon name="qr" className="size-[18px]" />
          {m.showAddress}
        </ActionButton>
      </div>
    );
  }

  const chain = getChain(quoted.coin.blockchain);
  const uri = chain ? paymentUri({ chain, depositAddress: quoted.deposit_address, tokenContract: coin.contract, amountBase: quoted.amount_in_base, decimals: quoted.coin.decimals }) : undefined;
  const isTest = isTestDepositAddress(quoted.deposit_address);
  /** The QR code carries the payment link with the amount when the network has one; otherwise only the address. */
  const qrValue = isTest ? quoted.deposit_address : (uri ?? quoted.deposit_address);
  const tips = [m.tipCopyAddress, format(m.tipExchangeFee, { amount: quoted.amount_in, symbol: quoted.coin.symbol }), m.tipWait];
  const showAddress = !quoted.deposit_memo || memoConfirmed;
  /** A new address waits for the customer to ask for it, so a tab left open does not request one every time the old one runs out. */
  const expire = () => setExpired(quoted);

  return (
    <div className="flex flex-col gap-3.5">
      {quoted.deposit_memo ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-danger/40 bg-danger-bg p-4">
          <p className="flex items-start gap-2 text-sm font-semibold text-danger">
            <Icon name="alert" className="mt-px size-4 shrink-0" />
            {m.memoWarning}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-all font-mono text-2xl font-semibold tracking-wider text-fg">{quoted.deposit_memo}</span>
            <CopyButton value={quoted.deposit_memo} label={m.copyMemo} className="shrink-0" />
          </div>
          <label className="flex items-start gap-2 text-body">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--accent)] sm:mt-[3px]" checked={memoConfirmed} onChange={(event) => setMemoConfirmed(event.target.checked)} />
            {m.memoConfirm}
          </label>
        </div>
      ) : null}

      {showAddress ? (
        <>
          {/** Narrow screens switch between address and QR code; wide screens show both and hide the switch, and both panes stay
              tab panels named by their tabs, which is valid even while the tab list is hidden. */}
          <Segmented
            role="tablist"
            look="strong"
            idPrefix={tabsId}
            label={m.addressViews}
            options={[
              { value: "address", label: m.addressTab },
              { value: "scan", label: m.scanTab },
            ]}
            value={addressView}
            onChange={setAddressView}
            className="w-full @[35rem]:hidden"
          />
          {/** The address as a ticket (wide: QR code, tear line, address) with the countdown tag on its bottom edge, outside the
              ticket's clipped box so half of it can hang below the border. */}
          <div className="relative mb-2">
            <div className="grid overflow-hidden rounded-[20px] border border-line bg-surface @[35rem]:grid-cols-[auto_0_minmax(0,1fr)]">
              <div
                role="tabpanel"
                id={`${tabsId}-panel-address`}
                aria-labelledby={`${tabsId}-tab-address`}
                className={`${addressView === "address" ? "flex" : "hidden"} flex-col gap-2 px-4 pt-4 pb-9 @[35rem]:col-start-3 @[35rem]:row-start-1 @[35rem]:flex @[35rem]:justify-center @[35rem]:px-[22px] @[35rem]:pt-[18px]`}
              >
                <span className="text-center text-meta text-muted">
                  {/** "one-time" stands out because the address works for this payment only. */}
                  {formatNodes(m.toAddress, { oneTime: <b className="font-bold text-danger">{m.oneTime}</b> })}
                </span>
                <AddressBlock address={quoted.deposit_address} />
              </div>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-scan`}
                aria-labelledby={`${tabsId}-tab-scan`}
                className={`${addressView === "scan" ? "flex" : "hidden"} flex-col items-center gap-3 px-4 pt-5 pb-9 @[35rem]:col-start-1 @[35rem]:row-start-1 @[35rem]:flex @[35rem]:px-[18px] @[35rem]:pt-[18px]`}
              >
                <div className="size-44 rounded-2xl border border-line bg-white p-3 @[35rem]:size-40 @[35rem]:p-2.5">
                  <QRCodeSVG value={qrValue} size={256} className="size-full" marginSize={0} />
                </div>
                <p className="max-w-[300px] text-center text-meta text-muted @[35rem]:hidden">{qrValue === uri ? m.scanFillsAll : m.scanFillsAddress}</p>
              </div>
              <TicketTear />
            </div>
            <span className="absolute bottom-0 left-1/2 inline-flex -translate-x-1/2 translate-y-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 font-heading text-[12.5px] font-bold whitespace-nowrap text-fg tabular-nums shadow-[0_6px_16px_-10px_rgb(0_0_0/0.35)]">
              <Icon name="clock" className="size-3.5" />
              {formatNodes(m.expiresIn, { time: <Countdown until={quoted.deadline} label={messages.common.minutesSeconds} onExpire={expire} /> })}
            </span>
          </div>

          {/** On narrow screens the copy buttons belong to the address view. */}
          <div className={`${addressView === "address" ? "grid" : "hidden"} grid-cols-2 gap-2.5 @[35rem]:grid`}>
            <CopyButton value={quoted.amount_in} label={m.copyAmount} variant="soft" className={COPY_BUTTON} />
            <CopyButton value={quoted.deposit_address} label={m.copyAddress} variant="soft" className={COPY_BUTTON} />
          </div>

          {/** The wallet-app link is for touch devices; a mouse or trackpad means a computer, also in the embedded checkout. */}
          {uri && !isTest ? (
            <ButtonLink href={uri} variant="secondary" size="lg" className="rounded-[18px]! pointer-fine:hidden">
              {m.openWalletApp}
            </ButtonLink>
          ) : null}

          {/** The tips start folded under "Before you send" and open into a numbered list. */}
          <details className="group rounded-[18px] border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[18px] px-4 py-3.5 font-heading text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
              {m.tipsTitle}
              <span className="flex items-center gap-1 font-sans text-[13px] font-medium text-muted">
                {format(m.tipsCount, { count: tips.length })}
                <Icon name="chevronDown" className="size-4 transition-transform duration-200 group-open:rotate-180" />
              </span>
            </summary>
            <ol className="flex flex-col gap-2.5 px-4 pb-3.5 text-meta text-muted">
              {tips.map((tip, index) => (
                <li key={tip} className="flex gap-2.5">
                  <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-full bg-surface-2 font-heading text-xs font-bold text-fg">
                    {index + 1}
                  </span>
                  {tip}
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : null}
      {errorMessage ? <StackedNotice tone="warn">{errorMessage}</StackedNotice> : null}
    </div>
  );
}
