"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef, useState } from "react";
import { callAction } from "@/components/dashboard/use-action";
import { ActionError } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ChainBadge } from "@/components/ui/chain-badge";
import { Field } from "@/components/ui/field";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { STEP_DROP_MOTION } from "@/components/ui/motion";
import { NetworkSelect } from "@/components/ui/network-select";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { WalletPicker } from "@/components/wallet/wallet-picker";
import { type ChainInfo, getChain } from "@/lib/chains/registry";
import { payoutChallengeAction, payoutFromSignInWalletAction, verifyPayoutAction } from "@/lib/merchants/actions/settlement";
import { type ConnectedWallet, isSigningKind, type SigningKind, type WalletKind } from "@/lib/wallets/client/types";
import { walletErrorDetails, walletErrorMessage } from "@/lib/wallets/client/wallet-errors";

export type PayoutChainOption = { id: string; name: string; family: WalletKind };

/** A wallet the user signed in with; its sign-in signature already proves ownership. */
export type SignInWallet = { kind: SigningKind; address: string };

/** The saved payout wallet and a way to prove a different one by signature; typed addresses are never accepted.
    Render with `key={payoutFormKey(payout)}` so a newly proven wallet, even the same address again, starts the form fresh. */
export function PayoutWalletForm({
  merchantId,
  chains,
  current,
  signInWallets = [],
  recommendedChain = null,
  chain: chosenChain,
  onBusyChange,
}: {
  /** The business the page shows; the server refuses the change if another one is selected since. */
  merchantId: string;
  chains: PayoutChainOption[];
  current?: { chain: string; address: string } | null;
  signInWallets?: SignInWallet[];
  /** The network tagged "Recommended", from the worker's measured route data; null when the data cannot tell. */
  recommendedChain?: string | null;
  /** A network chosen elsewhere on the page; the form then shows no network picker and asks for a wallet whenever the saved one is on another network. */
  chain?: string;
  /** Told when a wallet starts and stops being saved, so a network picker elsewhere can wait; the saved network is the one the click used. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [changingWallet, setChanging] = useState(!current);
  const changing = changingWallet || (chosenChain !== undefined && current?.chain !== chosenChain);
  /** Starts on a network the user's sign-in wallet works on, so the one-click "Use the wallet you signed in with" shows at once. */
  const [pickedChain, setChainId] = useState(current?.chain ?? chains.find((c) => signInWallets.some((wallet) => wallet.kind === c.family))?.id ?? chains[0]?.id ?? "");
  const chainId = chosenChain ?? pickedChain;
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; details: string | null } | null>(null);
  /** Whether a wallet signature is awaited, the one step a wallet can leave unanswered (a phone wallet dismissed without declining). */
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  /** Numbers each proof; "Use another wallet" moves it on, so a wallet that answers late cannot save its wallet or show an old error. */
  const attempt = useRef(0);
  const chain = chains.find((c) => c.id === chainId);
  const kinds = useMemo(() => (chain ? [chain.family] : []), [chain]);
  const networks = useMemo(() => chains.map((c) => getChain(c.id)).filter((c): c is ChainInfo => c !== undefined), [chains]);
  const savedChain = current ? getChain(current.chain) : undefined;
  const selectedChain = chain ? getChain(chain.id) : undefined;
  const signInWallet = chain ? signInWallets.find((wallet) => wallet.kind === chain.family) : undefined;
  const busy = status !== null;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const fail = (message: string, details: string | null = null) => {
    setError({ message, details });
    setStatus(null);
  };

  /** The actions revalidate the page, so the form then starts again under the saved wallet's key; until then it says it is updating. */
  const saved = () => setStatus("Payout wallet saved. Updating…");

  async function chooseSignInWallet(wallet: SignInWallet) {
    if (!chain) return;
    setError(null);
    setStatus("Saving your payout wallet…");
    const result = await callAction(() => payoutFromSignInWalletAction(merchantId, { kind: wallet.kind, address: wallet.address, payoutChain: chain.id }));
    if (!result.ok) return fail(result.error);
    saved();
  }

  async function prove(wallet: ConnectedWallet) {
    const { kind } = wallet;
    if (!chain) return;
    if (!isSigningKind(kind)) return fail("This wallet cannot be used as a payout wallet. Connect an EVM, Solana or NEAR wallet.");
    const run = ++attempt.current;
    setError(null);
    setStatus("Preparing the ownership message…");
    const challenge = await callAction(() => payoutChallengeAction(merchantId, { kind, address: wallet.address, payoutChain: chain.id }));
    if (run !== attempt.current) return;
    if (!challenge.ok) return fail(challenge.error);
    let proof: Awaited<ReturnType<ConnectedWallet["signMessage"]>>;
    try {
      setStatus("Sign the message in your wallet. It costs nothing and sends nothing.");
      setAwaitingWallet(true);
      proof = await wallet.signMessage({ message: challenge.message, near: challenge.near });
    } catch (cause) {
      if (run !== attempt.current) return;
      return fail(walletErrorMessage(cause, "The wallet did not sign the message."), walletErrorDetails(cause));
    } finally {
      if (run === attempt.current) setAwaitingWallet(false);
    }
    if (run !== attempt.current) return;
    const result = await callAction(() => verifyPayoutAction(merchantId, { nonce: challenge.nonce, signature: proof.signature, publicKey: proof.publicKey, payoutChain: chain.id }));
    if (!result.ok) return fail(result.error);
    /** The proof is saved; the wallet does not need to stay connected for payouts. */
    void wallet.disconnect().catch(() => undefined);
    saved();
  }

  /** Brings the wallet list back while a signature is awaited; the pending request is ignored if it answers later. */
  function chooseAnotherWallet() {
    attempt.current += 1;
    setAwaitingWallet(false);
    setStatus(null);
  }

  return (
    <div className="relative flex flex-col gap-4">
      <AnimatePresence initial={false} mode="popLayout">
        {changing ? (
          <m.div key="change" {...STEP_DROP_MOTION} className="flex flex-col gap-4">
            {chosenChain === undefined ? (
              <Field label="Network to get paid on" htmlFor="payout-chain">
                <NetworkSelect
                  id="payout-chain"
                  value={chainId}
                  onChange={(id) => {
                    setError(null);
                    setChainId(id);
                  }}
                  chains={networks}
                  recommended={recommendedChain}
                  disabled={busy}
                />
              </Field>
            ) : null}
            <p className="text-meta text-muted">
              {signInWallet
                ? "Use the wallet you signed in with, or connect another wallet and sign one message to verify you own it. Payments then go straight to this wallet."
                : "Connect the wallet that should receive payments and sign one message to verify you own it. Payments then go straight to this wallet."}
            </p>
            {status ? (
              <div className="flex flex-col gap-2">
                <OutcomeBanner tone="info" title={status} />
                {awaitingWallet ? (
                  <Button variant="ghost" onClick={chooseAnotherWallet}>
                    Use another wallet
                  </Button>
                ) : null}
              </div>
            ) : chain ? (
              <>
                {signInWallet ? (
                  <button
                    type="button"
                    onClick={() => chooseSignInWallet(signInWallet)}
                    className={`group flex items-center gap-3 rounded-2xl border border-accent bg-accent/10 p-3.5 text-left shadow-card transition-[border-color,background-color] duration-200 hover:bg-accent/15 ${FOCUS_RING}`}
                  >
                    {selectedChain ? <ChainBadge chain={selectedChain} className="size-9 text-[13px]" /> : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-heading text-body font-semibold">Use the wallet you signed in with</span>
                      <span className="truncate font-mono text-meta text-muted">{signInWallet.address}</span>
                    </span>
                    <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-2 text-muted transition-colors group-hover:bg-accent group-hover:text-accent-ink">
                      <Icon name="arrowRight" className="size-4" />
                    </span>
                  </button>
                ) : null}
                <WalletPicker key={chain.family} kinds={kinds} onConnected={prove} />
              </>
            ) : null}
            {current && status === null && (chosenChain === undefined || current.chain === chosenChain) ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setChanging(false);
                }}
              >
                Keep current wallet
              </Button>
            ) : null}
          </m.div>
        ) : current ? (
          /** The saved wallet as the selected tile, beside a tile that starts proving a different one. */
          <m.div key="saved" {...STEP_DROP_MOTION} className="@container">
            <div className="grid gap-3 @min-[440px]:grid-cols-2">
              <div className="relative flex flex-col gap-2.5 rounded-2xl border border-accent bg-accent/10 p-4 ring-[3px] ring-accent/25 @min-[440px]:min-h-[150px]">
                <span className="absolute top-3.5 right-3.5 grid size-[22px] place-items-center rounded-full bg-accent text-accent-ink" aria-hidden="true">
                  <Icon name="check" className="size-3" />
                </span>
                {savedChain ? <ChainBadge chain={savedChain} className="size-9 text-[13px]" /> : null}
                <p className="pr-7 font-heading text-base font-semibold">Payments go to your wallet on {savedChain?.name ?? current.chain}</p>
                <p className="break-all font-mono text-meta text-muted">{current.address}</p>
                <p className="flex items-start gap-1.5 text-meta text-success">
                  <Icon name="check" className="mt-[3px] size-3.5 shrink-0" />
                  Verified by signature. It stays saved when no wallet is connected.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChainId(current.chain);
                  setError(null);
                  setChanging(true);
                }}
                className={`flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-line p-4 text-center text-muted transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent-text ${FOCUS_RING} @min-[440px]:min-h-[150px]`}
              >
                <span className="grid size-9 place-items-center rounded-control bg-surface-2">
                  <Icon name="plus" className="size-[18px]" />
                </span>
                <span className="font-heading text-base font-semibold text-fg">Use a different wallet</span>
                <span className="text-meta">Verify a new wallet with one signature.</span>
              </button>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
      <ActionError message={error?.message ?? null} details={error?.details} tone="danger" />
    </div>
  );
}
