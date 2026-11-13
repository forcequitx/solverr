"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { Spinner } from "@/components/ui/spinner";
import { walletErrorText } from "@/components/wallet/wallet-error-text";
import { ChainLogo, WalletConnectLogo } from "@/components/wallet/wallet-logos";
import { en as messages } from "@/lib/i18n/messages/en";
import { connectWallet, preloadWalletConnectors } from "@/lib/wallets/client/connect";
import { testWallet } from "@/lib/wallets/client/test-wallet";
import type { ConnectedWallet, WalletKind } from "@/lib/wallets/client/types";

/** One button per chain family, each opening that family's wallet modal (Reown for EVM, Solana, Bitcoin, TRON and TON; NEAR Connect for NEAR). */
export function WalletPicker({
  kinds,
  onConnected,
  onError,
  onCancel,
  testMode = false,
  layout = "list",
  signsMessages = true,
}: {
  kinds: readonly WalletKind[];
  /** Runs with the connected wallet; the buttons stay locked until a returned promise settles, so a second connect cannot start mid-signature. */
  onConnected: (wallet: ConnectedWallet) => void | Promise<void>;
  /** Receives a failed connect's text (null when a new connect starts) for the caller to show; without it, a banner shows it here. */
  onError?: (message: string | null) => void;
  onCancel?: () => void;
  /** Test-mode checkouts connect a test wallet at once and never open a wallet app. */
  testMode?: boolean;
  /** "tiles": dashed tiles that sit side by side when there is room (the checkout); "list": stacked cards. */
  layout?: "list" | "tiles";
  /** Whether `onConnected` asks the wallet to sign a message (sign-in, payout wallet); false lists NEAR wallets that only send transactions too. */
  signsMessages?: boolean;
}) {
  const [busy, setBusy] = useState<WalletKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preloaded = useRef(false);
  /** Numbers each connect; Cancel and unmounting move it on, so a connect that finishes afterwards is dropped. */
  const attempt = useRef(0);
  const m = messages.walletPicker;

  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  /** The wallet connectors start loading once a pointer or focus reaches a button, not with the page, so they never slow its first render. */
  function preload() {
    if (testMode || preloaded.current) return;
    preloaded.current = true;
    preloadWalletConnectors(kinds);
  }

  async function connect(kind: WalletKind) {
    const current = ++attempt.current;
    const report = onError ?? setError;
    setBusy(kind);
    report(null);
    try {
      const wallet = testMode ? testWallet(kind, m.testWalletName) : await connectWallet(kind, { signsMessages });
      /** A wallet that connects after Cancel is not used, so no signing prompt appears later. It stays connected in its app. */
      if (attempt.current !== current) return;
      await onConnected(wallet);
    } catch (cause) {
      if (attempt.current === current) report(walletErrorText(cause, messages, messages.walletErrors.notConnected));
    } finally {
      if (attempt.current === current) setBusy(null);
    }
  }

  function cancel() {
    attempt.current += 1;
    setBusy(null);
    onCancel?.();
  }

  const tiles = layout === "tiles";
  const idle = tiles
    ? "border-dashed border-accent/40 bg-accent/4 hover:border-solid hover:border-accent disabled:pointer-events-none disabled:opacity-60"
    : "border-line bg-surface shadow-card hover:border-accent/40 hover:bg-accent/5 disabled:pointer-events-none disabled:opacity-60";
  return (
    <div className="flex flex-col gap-2.5">
      <div className={tiles ? "grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-2.5" : "flex flex-col gap-2.5"}>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={busy !== null}
            onPointerEnter={preload}
            onFocus={preload}
            onClick={() => connect(kind)}
            className={`group flex items-center text-left transition-[border-color,background-color] duration-200 ${FOCUS_RING} disabled:cursor-default ${
              tiles ? "gap-3.5 rounded-[18px] border-[1.5px] p-4" : "gap-3 rounded-2xl border p-3.5"
            } ${busy === kind ? "border-solid border-accent bg-accent/10" : idle}`}
          >
            <ChainLogo kind={kind} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-heading text-body font-semibold">{m.kinds[kind]}</span>
              {/** The mark lines up with the first line when the hint wraps on a narrow screen. */}
              <span className="flex items-start gap-1.5 text-meta text-muted">
                {busy === kind ? (
                  <>
                    <Spinner className="mt-[3px] size-3.5 shrink-0 text-accent-text" />
                    {m.checkWallet}
                  </>
                ) : testMode ? (
                  m.testHint
                ) : (
                  <>
                    {/** Phones leave the mark out so the hint has room on its line. */}
                    <WalletConnectLogo className="mt-[3px] max-sm:hidden" />
                    {m.hint}
                  </>
                )}
              </span>
            </span>
            <span
              className={`grid shrink-0 place-items-center bg-surface-2 text-muted transition-[color,background-color,translate] duration-200 group-hover:bg-accent group-hover:text-accent-ink ${
                tiles ? "size-9 rounded-full group-hover:translate-x-[3px]" : "size-8 rounded-control"
              }`}
            >
              <Icon name="arrowRight" className="size-4" />
            </span>
          </button>
        ))}
      </div>
      {error ? <OutcomeBanner tone="danger" title={error} /> : null}
      {onCancel ? (
        <Button variant="ghost" onClick={cancel}>
          {m.cancel}
        </Button>
      ) : null}
    </div>
  );
}
