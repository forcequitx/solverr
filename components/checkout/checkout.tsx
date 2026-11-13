"use client";

import { AnimatePresence, MotionConfig } from "motion/react";
/** Motion's lightweight `m` elements (see MotionProvider), named `motion` here because `m` holds this file's text. */
import * as motion from "motion/react-m";
import { useCallback, useEffect, useRef, useState } from "react";
import { coinRefusalText } from "@/components/checkout/api-error-text";
import { BestForYou } from "@/components/checkout/best-for-you";
import { CheckoutApiError, checkoutApi, type Payment } from "@/components/checkout/checkout-api";
import { CheckoutFooter } from "@/components/checkout/checkout-footer";
import { CheckoutLayout } from "@/components/checkout/checkout-layout";
import { CoinPicker } from "@/components/checkout/coin-picker";
import { useEmbedEscape } from "@/components/checkout/embed-escape";
import { ManualPay } from "@/components/checkout/manual-pay";
import { MethodChoice, type PayMethod } from "@/components/checkout/method-choice";
import { PayHero } from "@/components/checkout/pay-hero";
import { ReceiptEmail } from "@/components/checkout/receipt-email";
import {
  ChangedPaymentScreen,
  ExpiredScreen,
  FailedScreen,
  InProgressScreen,
  PaidScreen,
  RefundedScreen,
  UnderpaidScreen,
} from "@/components/checkout/result-screens";
import { SimulatePanel } from "@/components/checkout/simulate-panel";
import { StackedNotice } from "@/components/checkout/stacked-cards";
import { paymentStatusView, StatusTrack } from "@/components/checkout/status-track";
import { useLiveStatus } from "@/components/checkout/use-live-status";
import { canPayFromWallet, WalletPay } from "@/components/checkout/wallet-pay";
import { Badge } from "@/components/ui/badge";
import { CoinIcon } from "@/components/ui/coin-icon";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { BLUR_SWAP_MOTION } from "@/components/ui/motion";
import { coinAmount, formatShortAmount } from "@/lib/format";
import { format } from "@/lib/i18n/interpolate";
import { en as m } from "@/lib/i18n/messages/en";
import { ARRIVED_STATUSES, PAYABLE_STATUSES } from "@/lib/invoices/statuses";
import type { CheckoutState } from "@/lib/payments/checkout-state";
import type { CheckoutCoin } from "@/lib/payments/coins";
import type { ConnectedWallet } from "@/lib/wallets/client/types";

const POLL_MS = 5000;
/** While the live stream is connected, polling only catches an update the stream missed. */
const STREAM_POLL_MS = 30_000;
/** A simulated test payment changes every few seconds, so the page follows it closely while the live stream is not connected. */
const SIMULATED_POLL_MS = 1000;
const MOVING = new Set(["detected", "processing", "underpaid"]);
/** Status requests that fail in a row before the page says Solverr cannot be reached. */
const UNREACHABLE_AFTER = 3;
/** Longest the page waits on a wallet request before it follows the payment's status again. */
const WALLET_WAIT_MS = 2 * 60_000;

/** `amountUsd` is the amount due in US dollars, or null when the settlement coin's price is unknown and no estimate is shown. */
export function Checkout({ initial, coins, amountUsd, embedded }: { initial: CheckoutState; coins: CheckoutCoin[]; amountUsd: number | null; embedded: boolean }) {
  const [state, setState] = useState(initial);
  const [coin, setCoin] = useState<CheckoutCoin | null>(() => coins.find((c) => c.assetId === initial.payment?.coin.asset_id && initial.payment.state === "active") ?? null);
  /** The coin chosen in the picker before Continue; the pill under the picker shows it already. */
  const [previewCoin, setPreviewCoin] = useState<CheckoutCoin | null>(null);
  /** How the customer pays; null until they choose. A payment already open when the page loads shows its address, so it opens on manual. */
  const [method, setMethod] = useState<PayMethod | null>(() => (initial.payment?.state === "active" ? "manual" : null));
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [retriedPaymentId, setRetriedPaymentId] = useState<string | null>(null);
  const [sentPaymentId, setSentPaymentId] = useState<string | null>(null);
  /** True from Pay until the wallet answers; status polling waits so the page cannot leave the payment step while the wallet asks. */
  const [walletBusy, setWalletBusy] = useState(false);
  /** Set when a wallet request has gone unanswered for WALLET_WAIT_MS; the page then follows the payment again. */
  const [walletWaitOver, setWalletWaitOver] = useState(false);
  const onWalletBusy = useCallback((busy: boolean) => {
    setWalletBusy(busy);
    setWalletWaitOver(false);
  }, []);
  useEffect(() => {
    if (!walletBusy) return;
    const timer = setTimeout(() => setWalletWaitOver(true), WALLET_WAIT_MS);
    return () => clearTimeout(timer);
  }, [walletBusy]);
  /** A wallet that never answers (a dismissed phone request, a lost reply) holds the page for WALLET_WAIT_MS at most. */
  const walletHolding = walletBusy && !walletWaitOver;
  /** Whether the open address's time ran out, set by a timer rather than read from the clock while rendering, so server HTML and first render agree. */
  const openDeadline = state.payment?.state === "active" ? state.payment.deadline : null;
  const [expiredDeadline, setExpiredDeadline] = useState<string | null>(null);
  useEffect(() => {
    if (!openDeadline) return;
    const timer = setTimeout(() => setExpiredDeadline(openDeadline), Math.max(0, Date.parse(openDeadline) - Date.now()));
    return () => clearTimeout(timer);
  }, [openDeadline]);
  const addressExpired = openDeadline !== null && expiredDeadline === openDeadline;
  /** True once this page saved a receipt email, so the saved state stays shown after the next status poll reports the email. */
  const [receiptEmailSaved, setReceiptEmailSaved] = useState(false);
  /** The last coin NEAR Intents refused for this payment, with the dollar minimum it named, if any. */
  const [refusal, setRefusal] = useState<{ assetId: string; minimum: string | null } | null>(null);
  /** The business moved its payout wallet to another network after this payment was created, so no coin can pay it. */
  const [payoutChanged, setPayoutChanged] = useState(false);
  /** Payments this page created, plus the one open when it loaded; any other open payment was made somewhere else. */
  const [knownPaymentIds, setKnownPaymentIds] = useState<string[]>(() => (initial.payment ? [initial.payment.id] : []));
  const know = useCallback((id: string) => setKnownPaymentIds((ids) => (ids.includes(id) ? ids : [...ids, id])), []);
  /** The business's own coin and chain, suggested when a chosen coin needs a larger payment; none when the picker does not offer it
      or refuses it as a payment coin (some coins deliver fine but cannot pay). */
  const settlementCoin = coins.find((option) => option.sameAsSettlement && !option.refusal);
  const settlement = settlementCoin ? { symbol: settlementCoin.symbol, chainName: settlementCoin.chainName } : undefined;

  /** Each state request gets a number; a response is dropped when a newer state was already applied. */
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const failuresRef = useRef(0);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const next = await checkoutApi.state(initial.id);
      failuresRef.current = 0;
      setUnreachable(false);
      if (seq <= appliedRef.current) return;
      appliedRef.current = seq;
      setState(next);
    } catch (cause) {
      /** The next poll retries; only a run of failures shows a notice, and a rate-limited answer (Solverr is reachable) never counts toward it. */
      if (cause instanceof CheckoutApiError && cause.status === 429) return;
      failuresRef.current += 1;
      if (failuresRef.current >= UNREACHABLE_AFTER) setUnreachable(true);
    }
  }, [initial.id]);

  const paid = state.status === "paid";
  const simulated = state.mode === "test" && MOVING.has(state.status);

  /** Live updates stop once the invoice is paid, and pause while a wallet request waits for the person. */
  useLiveStatus(initial.id, refresh, {
    active: !paid && !walletHolding,
    pollMs: simulated ? SIMULATED_POLL_MS : POLL_MS,
    streamPollMs: STREAM_POLL_MS,
  });

  useEmbedEscape(embedded);

  const onQuoted = useCallback(
    (payment: Payment) => {
      know(payment.id);
      appliedRef.current = ++seqRef.current;
      setState((current) => ({ ...current, status: "awaiting_payment", payment: { ...payment, state: "active" } }));
      void refresh();
    },
    [refresh, know],
  );

  const onSent = useCallback(
    (payment: Payment, reported?: CheckoutState) => {
      know(payment.id);
      setSentPaymentId(payment.id);
      if (!reported) return onQuoted(payment);
      appliedRef.current = ++seqRef.current;
      setState(reported);
    },
    [onQuoted, know],
  );

  const canRetry = state.retry_allowed;
  const retry = () => {
    setRetriedPaymentId(state.payment?.id ?? "");
    setCoin(null);
  };

  const status = state.status;
  const walletSupported = coin ? canPayFromWallet(coin) : false;
  /** A retry hides the refund or failure of the payment it replaces; a later payment's outcome is shown again. */
  const retrying = retriedPaymentId !== null && (state.payment?.id ?? "") === retriedPaymentId;
  const showFlow = PAYABLE_STATUSES.has(status) || (retrying && (status === "refunded" || status === "failed"));
  /** An open payment this page did not create may carry someone else's refund address, so it is not shown for paying unconfirmed. */
  const changedPayment = state.payment && state.payment.state === "active" && PAYABLE_STATUSES.has(status) && !knownPaymentIds.includes(state.payment.id) ? state.payment : null;
  /** A payment sent from this page, or one reported earlier (a reload, another tab), keeps Pay off until its quote is no longer active. */
  const sent = state.payment?.state === "active" && (state.payment.id === sentPaymentId || state.payment.reported);
  /** The open payment for the chosen coin, if any: its exact amount replaces the estimate. */
  const quoted = coin && state.payment?.state === "active" && state.payment.coin.asset_id === coin.assetId ? state.payment : null;
  /** A sent payment came from a wallet; coins no wallet can send are paid manually; otherwise the customer's choice. */
  const activeMethod: PayMethod | null = sent ? "wallet" : !walletSupported ? "manual" : (method ?? (quoted ? "manual" : null));
  /** Once an address is shown for manual sending, or a wallet payment was sent, the method is fixed so one address is not paid twice;
      a wallet attempt that sent nothing keeps Send manually available, and the choice is locked while the wallet asks. */
  const showMethods = walletSupported && !sent && (!quoted || activeMethod === "wallet");
  const hasQuote = !!quoted;

  /** Reports a coin NEAR Intents refuses before the customer gives a refund address or opens a wallet; only while the payment flow is shown,
      since an ended payment's quote stops being active and must not trigger another check. */
  useEffect(() => {
    if (!coin || hasQuote || sent || !showFlow) return;
    let current = true;
    checkoutApi.estimate(state.id, [coin.assetId]).then(
      (body) => {
        const result = body.data?.[0];
        if (current && result && !result.ok && !result.temporary) setRefusal({ assetId: coin.assetId, minimum: result.minimum_usd ?? null });
      },
      (cause: unknown) => {
        if (current && cause instanceof CheckoutApiError && cause.code === "payout_changed") setPayoutChanged(true);
      },
    );
    return () => {
      current = false;
    };
  }, [coin, hasQuote, sent, showFlow, state.id]);
  const refused =
    coin && !hasQuote && !sent
      ? payoutChanged
        ? m.apiErrors.payoutChanged
        : refusal?.assetId === coin.assetId
          ? coinRefusalText(m, coin, refusal.minimum, settlement)
          : null
      : null;

  /** `screen` names what the card shows (a new screen slides in, updates within one do not); `title` is its heading, announced on change. */
  let body: React.ReactNode;
  let screen: string = status;
  let title: string | null = null;
  if (status === "paid") {
    title = m.results.paidTitle;
    body = <PaidScreen state={state} embedded={embedded} />;
  } else if (status === "detected" || status === "processing") {
    screen = "in-progress";
    title = status === "detected" ? m.results.detectedTitle : m.results.convertingTitle;
    body = <InProgressScreen payment={state.payment} status={status} />;
  } else if (status === "underpaid") {
    title = m.results.underpaidTitle;
    body = <UnderpaidScreen payment={state.payment} />;
  } else if (status === "expired") {
    title = m.results.expiredTitle;
    body = <ExpiredScreen merchant={state.merchant.name} />;
  } else if (!showFlow && status === "refunded") {
    title = m.results.refundedTitle;
    body = <RefundedScreen payment={state.payment} canRetry={canRetry} onRetry={retry} />;
  } else if (!showFlow && status === "failed") {
    title = m.results.failedTitle;
    body = <FailedScreen invoiceId={state.id} embedded={embedded} canRetry={canRetry} onRetry={retry} />;
  } else if (changedPayment) {
    screen = `changed-${changedPayment.id}`;
    title = m.checkout.changedTitle;
    body = (
      <ChangedPaymentScreen
        payment={changedPayment}
        onConfirm={() => {
          know(changedPayment.id);
          setCoin(coins.find((c) => c.assetId === changedPayment.coin.asset_id) ?? null);
          /** The confirmed payment already has an address, so it opens where that address is shown. */
          setMethod("manual");
        }}
      />
    );
  } else if (!coin) {
    screen = "pick";
    title = m.coinPicker.stepTitle;
    body = (
      <div className="@container flex flex-col gap-3">
        <div className="flex flex-col items-center gap-2.5 pt-0.5 text-center">
          <span className="flex w-full max-w-[460px] items-center gap-3 font-heading text-xs leading-none font-bold tracking-[0.14em] whitespace-nowrap text-muted uppercase before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            {m.coinPicker.stepLabel}
          </span>
          <h2 tabIndex={-1} className={`max-w-[460px] font-heading text-[19.5px] leading-snug font-bold tracking-[-0.02em] text-balance @[36rem]:text-[22px] ${FOCUS_RING}`}>
            {m.coinPicker.stepTitle}
          </h2>
        </div>
        {/** Ranking coins by cost needs the amount in dollars, so it is left out when the settlement coin's price is unknown. */}
        {amountUsd === null ? null : (
          <BestForYou
            invoiceId={state.id}
            coins={coins}
            amountUsd={amountUsd}
            testMode={state.mode === "test"}
            onPick={(picked, connected) => {
              setWallet(connected);
              setMethod("wallet");
              setCoin(picked);
            }}
          />
        )}
        <CoinPicker
          coins={coins}
          amountUsd={amountUsd}
          onSelect={(picked) => {
            /** A new coin asks again how the customer pays. */
            setMethod(null);
            setCoin(picked);
          }}
          onPreview={setPreviewCoin}
        />
      </div>
    );
  } else {
    screen = `pay-${coin.assetId}`;
    /** Once the page's own timer marks the address expired, the headline stops asking for the exact amount before the server retires it. */
    const sendingManually = activeMethod === "manual" && !!quoted && !addressExpired;
    body = (
      /** The amount to send is the headline; the method buttons and the chosen method's steps sit in a centered column below it. */
      <div className="@container flex flex-col items-center gap-[18px] @[35rem]:gap-[22px]">
        <PayHero
          label={sendingManually ? m.manualPay.sendExactly : m.checkout.youSend}
          amount={quoted ? quoted.amount_in : amountUsd === null ? null : coinAmount(amountUsd, coin)}
          approximate={!quoted || addressExpired}
          symbol={coin.symbol}
          blockchain={coin.blockchain}
          onChain={format(m.checkout.coinOnChain, { chain: coin.chainName })}
          networkNote={sendingManually ? format(m.manualPay.onChainOnly, { chain: coin.chainName }) : null}
          changeLabel={m.checkout.changeCoin}
          onChange={sent || walletHolding ? undefined : () => setCoin(null)}
        />
        {showMethods && !refused ? (
          <MethodChoice
            value={activeMethod}
            label={m.checkout.methodLabel}
            labels={{ wallet: m.checkout.walletTab, manual: m.checkout.manualTab }}
            disabled={walletHolding}
            onChange={setMethod}
          />
        ) : null}
        <div key={refused ? "refused" : (activeMethod ?? "none")} className="flex w-full max-w-[460px] animate-rise-in flex-col gap-3.5 [animation-delay:0ms]">
          {refused ? (
            <StackedNotice tone="warn">{refused}</StackedNotice>
          ) : activeMethod === "wallet" ? (
            <WalletPay
              invoiceId={state.id}
              coin={coin}
              settlement={settlement}
              wallet={wallet}
              sent={sent}
              testMode={state.mode === "test"}
              onWallet={setWallet}
              onQuoted={onQuoted}
              onSent={onSent}
              onBusyChange={onWalletBusy}
            />
          ) : activeMethod === "manual" ? (
            <ManualPay invoiceId={state.id} coin={coin} settlement={settlement} payment={state.payment} onQuoted={onQuoted} />
          ) : (
            <p className="text-center text-meta text-muted">{m.checkout.chooseMethod}</p>
          )}
        </div>
      </div>
    );
  }

  /** While choosing, a pill shows the coin picked before Continue; the payment step's headline shows the coin after that. */
  const coinPill = screen !== "pick" ? null : previewCoin ? (
    <motion.div
      key={previewCoin.assetId}
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.34, 1.3, 0.64, 1] } }}
      className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-full border border-line bg-surface py-2 pr-4 pl-2"
    >
      <CoinIcon symbol={previewCoin.symbol} className="size-[38px] text-sm" />
      <span className="text-meta leading-tight text-muted">
        <b className="block text-body font-semibold text-fg">{previewCoin.symbol}</b>
        {format(m.checkout.coinOnChain, { chain: previewCoin.chainName })}
      </span>
    </motion.div>
  ) : (
    <div className="flex min-h-14 items-center gap-2.5 rounded-full border border-dashed border-line px-4 text-meta text-muted">
      <Icon name="coins" className="size-4 shrink-0" />
      {m.checkout.noCoinYet}
    </div>
  );

  const statusView = paymentStatusView(state, { flowing: showFlow, sent, addressExpired }, m);
  /** Screen readers hear the new screen's title, or on the payment step the status track's current step. */
  const announcement = title ?? (statusView.current >= 0 ? statusView.steps[statusView.current].label : "");

  /** When the screen, method or address changes while focus was on content that went away, focus moves to the new screen's heading;
      the first render, and focus elsewhere on the page, are left alone. */
  const screensRef = useRef<HTMLDivElement>(null);
  const focusKey = `${screen}|${activeMethod}|${quoted?.id ?? ""}`;
  const shownKeyRef = useRef(focusKey);
  useEffect(() => {
    if (shownKeyRef.current === focusKey) return;
    shownKeyRef.current = focusKey;
    const current = [...(screensRef.current?.querySelectorAll<HTMLElement>("[data-screen]") ?? [])].find((node) => node.dataset.screen === screen);
    const focused = document.activeElement;
    if (!current || (focused && focused !== document.body && (current.contains(focused) || !screensRef.current?.contains(focused)))) return;
    current.querySelector<HTMLElement>("h2[tabindex]")?.focus();
  }, [focusKey, screen]);

  return (
    /** Reduced motion applies to the whole checkout: the step screens and the coin pill. */
    <MotionConfig reducedMotion="user">
      <CheckoutLayout
        merchant={state.merchant.name}
        logoUrl={state.merchant.logo_url}
        amount={{ label: ARRIVED_STATUSES.has(status) ? m.checkout.amountPaid : m.checkout.amountDue, value: formatShortAmount(state.amount), currency: state.currency }}
        badge={state.mode === "test" ? <Badge tone="warn">{m.common.demo}</Badge> : null}
        status={<StatusTrack view={statusView} />}
        footer={<CheckoutFooter invoiceId={state.id} embedded={embedded} />}
      >
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {unreachable ? <StackedNotice tone="warn">{m.checkout.unreachable}</StackedNotice> : null}
        {state.payments_delayed ? <StackedNotice tone="warn">{m.checkout.paymentsDelayed}</StackedNotice> : null}
        <div ref={screensRef} className="relative">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={screen} data-screen={screen} {...BLUR_SWAP_MOTION}>
              {body}
            </motion.div>
          </AnimatePresence>
        </div>
        {coinPill}
        {/** Receipts are sent only for paid invoices, so the form is left out where the invoice can no longer be paid. */}
        {state.email_receipts && (!state.receipt_email_set || receiptEmailSaved) && status !== "expired" && !((status === "refunded" || status === "failed") && !canRetry) ? (
          <div className="border-t border-line pt-4">
            <ReceiptEmail invoiceId={state.id} onSaved={() => setReceiptEmailSaved(true)} />
          </div>
        ) : null}
        {/** Test mode: shown on the payment step once the chosen coin's payment address exists, because only an open payment can be
            simulated, and after "Change coin" the previous coin's address must not be. */}
        {state.mode === "test" && PAYABLE_STATUSES.has(status) && quoted && !changedPayment ? (
          <div className="mx-auto w-full max-w-[460px]">
            <SimulatePanel invoiceId={state.id} onSimulated={refresh} />
          </div>
        ) : null}
      </CheckoutLayout>
    </MotionConfig>
  );
}
