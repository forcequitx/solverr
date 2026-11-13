"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { CopyableValue } from "@/components/dashboard/detail/copyable-value";
import { useAction } from "@/components/dashboard/use-action";
import { ActionError } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { EXPAND_MOTION, listItemMotion } from "@/components/ui/motion";
import { WalletPicker } from "@/components/wallet/wallet-picker";
import { removeSignInWalletAction, signOutOtherDevicesAction } from "@/lib/merchants/actions/account";
import type { ConnectedWallet, WalletKind } from "@/lib/wallets/client/types";
import { walletErrorDetails, walletErrorMessage } from "@/lib/wallets/client/wallet-errors";
import { SignInRefused, walletSignIn } from "@/lib/wallets/client/wallet-sign-in";

const LINK_WALLET_KINDS: readonly WalletKind[] = ["evm", "solana", "near"];

const LINK_FAILED = "The wallet was not linked. Connect it again and approve the sign-in message.";

/** Links another wallet to this login by signing in with it while already signed in. */
function LinkWallet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<{ message: string; details: string | null } | null>(null);

  async function link(wallet: ConnectedWallet) {
    setError(null);
    try {
      await walletSignIn(wallet, LINK_FAILED);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof SignInRefused ? { message: cause.message, details: null } : { message: walletErrorMessage(cause, LINK_FAILED), details: walletErrorDetails(cause) },
      );
    }
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      {open ? (
        <m.div key="picker" {...EXPAND_MOTION} className="overflow-hidden">
          <div className="flex flex-col gap-2 rounded-[14px] border border-line p-4">
            <WalletPicker kinds={LINK_WALLET_KINDS} onConnected={link} onCancel={() => setOpen(false)} />
            <ActionError message={error?.message ?? null} details={error?.details} tone="danger" />
          </div>
        </m.div>
      ) : (
        <m.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Icon name="plus" className="size-4" />
            Link another wallet
          </Button>
        </m.div>
      )}
    </AnimatePresence>
  );
}

type SignInWallet = { id: string; kind: string; address: string };

/** How many other devices are signed in to this login, with a button that signs them all out. */
function OtherDevices({ count }: { count: number }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line px-4 py-3">
      <p className="text-body">
        {count === 0 ? "No other device is signed in to your account." : `You are also signed in on ${count} other ${count === 1 ? "device" : "devices"}.`}
      </p>
      {count > 0 ? (
        <ConfirmAction
          label="Sign out other devices"
          confirmLabel="Sign out"
          ariaLabel="Sign out every other device"
          pending={pending}
          error={error}
          onConfirm={() => run(() => signOutOtherDevicesAction())}
        />
      ) : null}
    </div>
  );
}

/** One sign-in wallet, with Remove when the login has another way to sign in. */
function SignInWalletItem({ wallet, index, removable }: { wallet: SignInWallet; index: number; removable: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <m.li {...listItemMotion(index)} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2.5">
      <span className="flex min-w-[12rem] flex-1 items-center gap-3">
        <span className="w-20 shrink-0">
          <Badge tone="info">
            <span className="uppercase">{wallet.kind}</span>
          </Badge>
        </span>
        <CopyableValue value={wallet.address} ariaLabel={`Copy the ${wallet.kind.toUpperCase()} address`} />
      </span>
      {removable ? (
        <ConfirmAction
          label="Remove"
          confirmLabel="Remove"
          ariaLabel={`Remove the sign-in wallet ${wallet.address}`}
          pending={pending}
          error={error}
          onConfirm={() => run(() => removeSignInWalletAction(wallet.id))}
        />
      ) : null}
    </m.li>
  );
}

/** Wallets and the email that sign this user in, with a button to link one more wallet, and the other signed-in devices. */
export function SignInMethods({ wallets, email, otherDevices }: { wallets: SignInWallet[]; email: string | null; otherDevices: number }) {
  /** A wallet can be removed only while another wallet or the email still signs in. */
  const removable = wallets.length + (email ? 1 : 0) > 1;
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        <AnimatePresence initial={false}>
          {wallets.map((wallet, index) => (
            <SignInWalletItem key={wallet.id} wallet={wallet} index={index} removable={removable} />
          ))}
          {email ? (
            <m.li key="email" {...listItemMotion(wallets.length)} className="flex min-h-[52px] items-center gap-3 border-b border-line py-2.5">
              <span className="w-20 shrink-0">
                <Badge tone="muted">Email</Badge>
              </span>
              <span className="min-w-0 flex-1 break-all text-body">{email}</span>
            </m.li>
          ) : null}
        </AnimatePresence>
      </ul>
      <LinkWallet />
      <OtherDevices count={otherDevices} />
    </div>
  );
}
