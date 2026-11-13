"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { isSignInLinkError } from "@/components/auth/sign-in-link-error";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { WalletPicker } from "@/components/wallet/wallet-picker";
import type { ConnectedWallet } from "@/lib/wallets/client/types";
import { walletErrorMessage } from "@/lib/wallets/client/wallet-errors";
import { postSignIn, SignInRefused, walletSignIn } from "@/lib/wallets/client/wallet-sign-in";

const ALL_KINDS = ["evm", "solana", "near"] as const;
const SIGN_IN_FAILED = "Sign-in failed. Try again.";
/** Sends a signed-in user to the dashboard or to the setup step they reached. */
const AFTER_SIGN_IN = "/signin";

const signInErrorText = (cause: unknown) => (cause instanceof SignInRefused ? cause.message : walletErrorMessage(cause, SIGN_IN_FAILED));

/** The sign-in step of setup. A wallet signs a one-time message (nothing is sent, no fee); the first sign-in creates the account. */
export function SignInStep({ emailEnabled }: { emailEnabled: boolean }) {
  const router = useRouter();
  const linkFailed = isSignInLinkError(useSearchParams().get("error"));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [sending, setSending] = useState(false);
  /** Numbers each wallet sign-in; "Use another wallet" moves it on, so a wallet that answers late cannot show an old error. */
  const attempt = useRef(0);

  async function signInWithWallet(wallet: ConnectedWallet) {
    const current = ++attempt.current;
    setError(null);
    try {
      setStatus("Preparing the sign-in message…");
      await walletSignIn(wallet, SIGN_IN_FAILED, () => current === attempt.current && setStatus("Sign the message in your wallet. It costs nothing."));
      /** The session is set; the wallet does not need to stay connected. A late signature still signs in, since it did. */
      void wallet.disconnect().catch(() => undefined);
      setStatus("Signed in. Opening your account…");
      router.replace(AFTER_SIGN_IN);
    } catch (cause) {
      if (current !== attempt.current) return;
      setError(signInErrorText(cause));
      setStatus(null);
    }
  }

  /** A wallet can leave the request unanswered (a phone wallet dismissed without declining); this brings the wallet list back. */
  function chooseAnotherWallet() {
    attempt.current += 1;
    setStatus(null);
  }

  async function sendLink(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      await postSignIn("/api/auth/sign-in/magic-link", { email: email.trim(), callbackURL: AFTER_SIGN_IN }, SIGN_IN_FAILED);
      setEmailSent(true);
    } catch (cause) {
      setError(signInErrorText(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {linkFailed && !emailSent ? <OutcomeBanner tone="danger" title="This sign-in link expired or was already used. Send a new one." /> : null}
      {status ? (
        <div className="flex flex-col gap-2">
          <OutcomeBanner tone="info" title={status} />
          <Button variant="ghost" onClick={chooseAnotherWallet}>
            Use another wallet
          </Button>
        </div>
      ) : (
        <WalletPicker kinds={ALL_KINDS} onConnected={signInWithWallet} />
      )}
      {emailEnabled ? (
        <>
          <div className="flex items-center gap-3 font-heading text-xs font-semibold uppercase tracking-[0.06em] text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          {emailSent ? (
            <OutcomeBanner tone="success" title="Check your inbox">
              The sign-in link works once and expires in 5 minutes.
            </OutcomeBanner>
          ) : (
            <form onSubmit={sendLink} className="flex flex-col gap-3">
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" />
              </Field>
              <ActionButton type="submit" variant="secondary" disabled={!email.trim()} pending={sending} pendingLabel="Sending…">
                Send a sign-in link
              </ActionButton>
            </form>
          )}
        </>
      ) : null}
      {error ? <OutcomeBanner tone="danger" title={error} /> : null}
    </div>
  );
}
