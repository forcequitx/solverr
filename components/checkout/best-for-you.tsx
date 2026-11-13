"use client";

import { useRef, useState } from "react";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi } from "@/components/checkout/checkout-api";
import { StackedNotice } from "@/components/checkout/stacked-cards";
import { Badge } from "@/components/ui/badge";
import { CoinChainIcon } from "@/components/ui/coin-chain-icon";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { useWalletLost } from "@/components/wallet/use-wallet-lost";
import { WalletPicker } from "@/components/wallet/wallet-picker";
import { en as messages } from "@/lib/i18n/messages/en";
import type { CheckoutCoin } from "@/lib/payments/coins";
import type { Estimate } from "@/lib/payments/estimate";
import { readHoldings } from "@/lib/wallets/client/balances";
import { testHoldings } from "@/lib/wallets/client/test-wallet";
import type { ConnectedWallet } from "@/lib/wallets/client/types";
import { shortAddress } from "@/lib/wallets/short-address";

const MAX_CANDIDATES = 5;
const HEADROOM = 1.02;
/** Estimates are for comparing coins; the exact amount comes with the payment address, so six significant digits are enough here. */
const ESTIMATE_DIGITS = 6;
/** Stacked cards: a front card with a tray (or a slim ghost card) tucked under it. */
const DECK = "relative mx-auto flex w-full max-w-[460px] flex-col";
const FRONT =
  "relative z-[2] flex min-h-16 w-full animate-deck-drop items-center gap-3 rounded-[20px] border border-line bg-surface py-2.5 pr-3 pl-2.5 text-left font-heading text-sm leading-snug font-semibold shadow-[0_14px_30px_-22px_rgb(0_0_0/0.45)] @[36rem]:text-[15px]";
const ICON = "grid size-11 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_13%,var(--surface))] text-accent-text";

type Ranked = { coin: CheckoutCoin; estimate: Extract<Estimate, { ok: true }> };

/** Reads the connected wallet's balances and ranks the coins it can pay with by the quoted cost. Test mode uses a test wallet with sample balances. */
export function BestForYou({
  invoiceId,
  coins,
  amountUsd,
  testMode,
  onPick,
}: {
  invoiceId: string;
  coins: CheckoutCoin[];
  amountUsd: number;
  testMode: boolean;
  onPick: (coin: CheckoutCoin, wallet: ConnectedWallet) => void;
}) {
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  /** `progress` names the step being worked on (a spinner shows); `notice` explains a finished ranking or an error. */
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  /** Each ranking gets a number; results that come back after a newer ranking or a lost wallet are dropped. */
  const runRef = useRef(0);
  const m = messages.bestForYou;

  /** Forgets the connected wallet and its ranking, so another wallet can be connected; a ranking still running is dropped. */
  function resetWallet(notice: string | null) {
    runRef.current += 1;
    setWallet(null);
    setRanked(null);
    setProgress(null);
    setNotice(notice);
  }

  useWalletLost(wallet, () => resetWallet(messages.walletPay.disconnected));

  async function rank(connected: ConnectedWallet) {
    const run = ++runRef.current;
    setWallet(connected);
    setRanked(null);
    setNotice(null);
    setProgress(m.readingBalances);
    try {
      const held = testMode ? testHoldings(connected.kind, coins, amountUsd) : await readHoldings(connected.kind, connected.address, coins);
      const holdings = held.filter((h) => h.usd >= amountUsd * HEADROOM);
      if (run !== runRef.current) return;
      if (holdings.length === 0) {
        setProgress(null);
        setNotice(m.notEnough);
        return setRanked([]);
      }
      const candidates = holdings
        .filter((holding) => !holding.coin.refusal)
        .sort((a, b) => Number(b.coin.sameAsSettlement) - Number(a.coin.sameAsSettlement) || b.usd - a.usd)
        .slice(0, MAX_CANDIDATES);
      if (candidates.length === 0) {
        setProgress(null);
        setNotice(m.noneUsable);
        return setRanked([]);
      }
      setProgress(m.comparing);
      const body = await checkoutApi.estimate(invoiceId, candidates.map((h) => h.coin.assetId), connected.address);
      if (run !== runRef.current) return;
      const results = (body.data ?? [])
        .filter((estimate): estimate is Extract<Estimate, { ok: true }> => estimate.ok)
        .map((estimate) => ({ coin: candidates.find((h) => h.coin.assetId === estimate.asset_id)!.coin, estimate }))
        .sort((a, b) => Number(a.estimate.amount_in_usd ?? Infinity) - Number(b.estimate.amount_in_usd ?? Infinity));
      setRanked(results);
      setProgress(null);
      setNotice(results.length === 0 ? m.noneUsable : null);
    } catch (cause) {
      if (run !== runRef.current) return;
      /** The wallet picker comes back so the person can try again. */
      setWallet(null);
      setRanked(null);
      setProgress(null);
      setNotice(apiErrorText(cause, messages));
    }
  }

  /** Each state (closed, working, ranked, open) drops its front card in again; the tray or ghost card slides out under it. */
  const phase = !open ? "closed" : progress ? "working" : ranked && ranked.length > 0 ? "ranked" : "open";
  const walletIcon = (
    <span className={ICON}>
      <Icon name="wallet" className="size-[19px]" />
    </span>
  );

  if (!open || progress) {
    return (
      <div key={phase} className={DECK}>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={`${FRONT} group transition-[border-color,translate] duration-200 hover:-translate-y-px hover:border-accent/50 ${FOCUS_RING}`}>
            {walletIcon}
            <span className="min-w-0 flex-1">{m.connect}</span>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-transform duration-300 group-hover:translate-x-[3px]">
              <Icon name="arrowRight" className="size-4" />
            </span>
          </button>
        ) : (
          <p role="status" className={`${FRONT} text-accent-text`}>
            <span className={ICON}>
              <Spinner className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">{progress}</span>
          </p>
        )}
        <span
          aria-hidden="true"
          className={`relative z-[1] mx-4 -mt-2.5 h-[18px] animate-deck-slide rounded-b-2xl border border-t-0 border-line [animation-delay:120ms] ${
            progress ? "animate-shimmer-x bg-[linear-gradient(90deg,var(--surface-2),color-mix(in_srgb,var(--accent)_14%,var(--surface-2)),var(--surface-2))] bg-[length:200%_100%]" : "bg-surface-2"
          }`}
        />
      </div>
    );
  }

  return (
    <div key={phase} className={DECK}>
      <div className={FRONT}>
        {walletIcon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading text-[17px] leading-tight font-bold">{m.title}</span>
          {wallet ? (
            <span className="truncate font-sans text-[13px] font-normal text-muted">
              {wallet.name} · {shortAddress(wallet.address)}
            </span>
          ) : null}
        </span>
      </div>
      <div className="relative z-[1] mx-1.5 -mt-5 flex animate-deck-slide flex-col gap-2.5 rounded-b-[20px] border border-t-0 border-line bg-surface-2 px-2.5 pt-[30px] pb-2.5 [animation-delay:120ms] @[36rem]:mx-2.5 @[36rem]:px-3.5 @[36rem]:pt-8 @[36rem]:pb-3.5">
        {!wallet ? <WalletPicker kinds={["evm", "solana", "near"]} layout="tiles" testMode={testMode} signsMessages={false} onConnected={rank} onError={setNotice} /> : null}
        {notice ? <StackedNotice tone="info">{notice}</StackedNotice> : null}
        {!wallet ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={`h-12 rounded-2xl border-[1.5px] border-line bg-surface font-heading text-[15px] font-semibold transition-colors hover:border-accent/45 ${FOCUS_RING}`}
          >
            {messages.walletPicker.cancel}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => resetWallet(null)}
            className={`h-12 rounded-2xl border-[1.5px] border-line bg-surface font-heading text-[15px] font-semibold transition-colors hover:border-accent/45 ${FOCUS_RING}`}
          >
            {m.otherWallet}
          </button>
        )}
        {ranked && ranked.length > 0 && wallet ? (
          <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
            {ranked.map((entry, index) => (
              <li key={entry.coin.assetId} className="animate-rise-in border-b border-line last:border-b-0" style={{ animationDelay: `${120 + index * 60}ms` }}>
                <button
                  type="button"
                  onClick={() => onPick(entry.coin, wallet)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/6 focus-visible:bg-accent/6 focus-visible:outline-none"
                >
                  <CoinChainIcon symbol={entry.coin.symbol} blockchain={entry.coin.blockchain} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-heading font-semibold text-fg">{entry.coin.symbol}</span>
                      {index === 0 ? <Badge tone="success">{m.lowestCost}</Badge> : <span className="text-meta text-muted">{m.alsoPossible}</span>}
                    </span>
                    <span className="truncate text-meta text-muted">{entry.coin.chainName}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-heading text-sm font-semibold whitespace-nowrap tabular-nums">
                      {Number(entry.estimate.amount_in).toLocaleString("en-US", { maximumSignificantDigits: ESTIMATE_DIGITS })} {entry.coin.symbol}
                    </span>
                    {entry.estimate.amount_in_usd ? <span className="block text-meta tabular-nums text-muted">≈ ${Number(entry.estimate.amount_in_usd).toFixed(2)}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
