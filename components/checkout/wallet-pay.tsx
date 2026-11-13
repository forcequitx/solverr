"use client";

import { useState } from "react";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi, CheckoutApiError, type Payment } from "@/components/checkout/checkout-api";
import { StackedNotice } from "@/components/checkout/stacked-cards";
import { ActionButton } from "@/components/ui/action-button";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { useWalletLost } from "@/components/wallet/use-wallet-lost";
import { walletErrorText } from "@/components/wallet/wallet-error-text";
import { ChainLogo } from "@/components/wallet/wallet-logos";
import { WalletPicker } from "@/components/wallet/wallet-picker";
import { format } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";
import { isTestDepositAddress } from "@/lib/oneclick/test-deposit";
import type { CheckoutState } from "@/lib/payments/checkout-state";
import type { CheckoutCoin } from "@/lib/payments/coins";
import { type ConnectedWallet, WalletError, type WalletKind } from "@/lib/wallets/client/types";
import { shortAddress } from "@/lib/wallets/short-address";

const ANY_COIN_KINDS: readonly string[] = ["evm", "solana", "near"];
const NATIVE_COIN_KINDS: readonly string[] = ["bitcoin", "tron", "ton"];

/** Whether a connected wallet can pay this coin: any coin on EVM, Solana and NEAR; only the chain's own coin on Bitcoin, TRON and TON. */
export function canPayFromWallet(coin: CheckoutCoin): boolean {
  return ANY_COIN_KINDS.includes(coin.family) || (NATIVE_COIN_KINDS.includes(coin.family) && coin.contract === null);
}

/** Connects a wallet, quotes with it as refund address and sends the exact amount; Pay stays off while `sent`, and `onBusyChange`
    is true from Pay until the wallet answers, so the page stays on this step. */
export function WalletPay({
  invoiceId,
  coin,
  settlement,
  wallet,
  sent,
  testMode,
  onWallet,
  onQuoted,
  onSent,
  onBusyChange,
}: {
  invoiceId: string;
  coin: CheckoutCoin;
  /** The coin and chain the business receives, suggested when this coin needs a larger payment and the picker offers it. */
  settlement?: { symbol: string; chainName: string };
  wallet: ConnectedWallet | null;
  sent: boolean;
  /** Test-mode checkouts connect a test wallet instead of a real one. */
  testMode: boolean;
  onWallet: (wallet: ConnectedWallet | null) => void;
  /** Runs as soon as this page creates the payment, before the wallet opens, so the checkout knows the payment is its own. */
  onQuoted: (payment: Payment) => void;
  onSent: (payment: Payment, reported?: CheckoutState) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A test quote has a test deposit address, so nothing is sent; the note pointing to the Simulate panel replaces Pay. */
  const [testQuoted, setTestQuoted] = useState(false);
  const kind = coin.family as WalletKind;
  const m = messages.walletPay;

  useWalletLost(wallet, () => {
    onWallet(null);
    setError(m.disconnected);
  });

  /** A payment reported before this page loaded (a reload, another tab) has no wallet here; it only waits for the network. */
  if (sent && (!wallet || wallet.kind !== kind)) return <StackedNotice tone="info">{m.sentWaiting}</StackedNotice>;

  if (!wallet || wallet.kind !== kind) {
    return (
      <div className="flex flex-col gap-3.5">
        <p className="text-center text-meta text-muted">{m.step}</p>
        <WalletPicker
          kinds={[kind]}
          layout="tiles"
          testMode={testMode}
          signsMessages={false}
          onConnected={(connected) => {
            setError(null);
            onWallet(connected);
          }}
          onError={setError}
        />
        {error ? <StackedNotice tone="warn">{error}</StackedNotice> : null}
      </div>
    );
  }

  async function pay(connected: ConnectedWallet) {
    setError(null);
    onBusyChange(true);
    try {
      setBusy(m.preparing);
      const payment = await checkoutApi.quote(invoiceId, coin.assetId, connected.address);
      onQuoted(payment);
      if (isTestDepositAddress(payment.deposit_address)) {
        setTestQuoted(true);
        return;
      }
      /** A wallet transfer carries no memo and sends the chosen coin's contract, so it must match the quoted coin exactly. */
      if (payment.coin.asset_id !== coin.assetId || payment.deposit_memo) throw new WalletError("unsupportedToken");
      setBusy(m.approve);
      const txHash = await connected.pay({
        evmChainId: coin.evmChainId ?? undefined,
        tokenContract: coin.contract,
        amountBase: payment.amount_in_base,
        decimals: payment.coin.decimals,
        depositAddress: payment.deposit_address,
      });
      setBusy(m.confirming);
      const reported = await (txHash ? checkoutApi.deposit(invoiceId, txHash, payment.id) : checkoutApi.walletSent(invoiceId, payment.id)).catch(() => undefined);
      onSent(payment, reported);
    } catch (cause) {
      setError(
        cause instanceof CheckoutApiError
          ? apiErrorText(cause, messages, { coin, settlement })
          : walletErrorText(cause, messages, m.failed, { symbol: coin.symbol, chainName: coin.chainName }),
      );
    } finally {
      setBusy(null);
      onBusyChange(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col items-center gap-1 rounded-[22px] bg-surface-2 px-4 pt-5 pb-4 text-center">
        <span className="mb-2 grid size-16 animate-ring-in place-items-center rounded-full bg-surface shadow-[0_0_0_3px_var(--success-bg),0_0_0_5px_color-mix(in_srgb,var(--success)_45%,transparent)]">
          <ChainLogo kind={wallet.kind} />
        </span>
        <span className="max-w-full truncate font-heading text-base font-semibold">{wallet.name}</span>
        <span className="max-w-full truncate text-meta text-muted tabular-nums">
          {m.connected} {shortAddress(wallet.address)}
        </span>
        <button
          type="button"
          className={`mt-2 h-8 rounded-full pointer-coarse:h-11 pointer-coarse:px-5 border border-line bg-surface px-4 font-heading text-[13px] font-semibold transition-colors hover:border-accent/45 ${FOCUS_RING}`}
          onClick={() => onWallet(null)}
        >
          {m.change}
        </button>
      </div>
      <p className="text-center text-meta text-muted">{format(m.payingWith, { symbol: coin.symbol, chain: coin.chainName })}</p>
      {testQuoted ? (
        <StackedNotice tone="warn">{m.testPayment}</StackedNotice>
      ) : (
        <ActionButton size="lg" className="group h-[58px]! w-full rounded-[18px]! text-[17px]!" disabled={sent} pending={busy !== null} pendingLabel={busy} onClick={() => pay(wallet)}>
          {sent ? (
            m.confirming
          ) : (
            <>
              {format(m.payButton, { symbol: coin.symbol })}
              <Icon name="arrowRight" className="size-4 transition-transform duration-200 group-hover:translate-x-[3px]" />
            </>
          )}
        </ActionButton>
      )}
      {error ? <StackedNotice tone="warn">{error}</StackedNotice> : null}
    </div>
  );
}
