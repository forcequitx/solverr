"use client";

import { useRef, useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { callAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useWalletLost } from "@/components/wallet/use-wallet-lost";
import { WalletPicker } from "@/components/wallet/wallet-picker";
import { prepareTransferAction, reportTransferAction } from "@/lib/merchants/actions/transfers";
import type { ConnectedWallet, WalletKind } from "@/lib/wallets/client/types";
import { walletErrorDetails, walletErrorMessage } from "@/lib/wallets/client/wallet-errors";
import { shortAddress } from "@/lib/wallets/short-address";

/** Payout addresses show more characters here, so the merchant can match the connected wallet to the saved one. */
const ADDRESS_HEAD = 8;
const ADDRESS_TAIL = 6;
const short = (address: string) => shortAddress(address, ADDRESS_HEAD, ADDRESS_TAIL);

/** Connects the proven payout wallet, prepares the transfer, and sends it from that wallet. */
export function TransferSigner({ transferId, payoutKind, payoutAddress }: { transferId: string; payoutKind: WalletKind; payoutAddress: string }) {
  const merchantId = useMerchantId();
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [preparedBefore, setPreparedBefore] = useState(false);
  /** A transaction the wallet sent and the address it paid, kept until Solverr records it. */
  const [sent, setSent] = useState<{ txHash: string; paidTo: string } | null>(null);
  const [pastedHash, setPastedHash] = useState("");
  /** Whether the wallet's approval is awaited, the one step a wallet can leave unanswered (a phone wallet dismissed without declining). */
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const sendingRef = useRef(false);
  /** Numbers each send; stopping the wait moves it on, so a late wallet failure cannot show over the next step. */
  const attempt = useRef(0);

  useWalletLost(wallet, () => {
    /** A send in flight settles through its own promise; resetting here would offer the button again mid-send. */
    if (sendingRef.current) return;
    setWallet(null);
    setStatus(null);
    setError("Your wallet disconnected or switched to another account. Connect your payout wallet again.");
  });

  function fail(message: string, details: string | null = null) {
    setStatus(null);
    setError(message);
    setErrorDetails(details);
  }

  /** Records a sent transaction, with the address the wallet paid when known; on failure the hash is kept so recording can be retried
      without sending again. The action revalidates the page. */
  async function record(txHash: string, paidTo?: string) {
    setError(null);
    setErrorDetails(null);
    setStatus("Recording the transaction…");
    const reported = await callAction(() => reportTransferAction(merchantId, transferId, txHash, paidTo));
    if (!reported.ok) return fail(`${reported.error} The transfer may already be on its way, so record it again instead of sending it again.`);
    setStatus(null);
  }

  async function send(connected: ConnectedWallet, sendAgain = false) {
    setError(null);
    setErrorDetails(null);
    if (connected.address.toLowerCase() !== payoutAddress.toLowerCase()) {
      fail(`Connect your payout wallet ${short(payoutAddress)}. The connected wallet is ${short(connected.address)}.`);
      return;
    }
    setStatus("Preparing the transfer…");
    sendingRef.current = true;
    const run = ++attempt.current;
    try {
      /** Through callAction, so a lost connection reads as such and not as a wallet failure. */
      const prepared = await callAction(() => prepareTransferAction(merchantId, transferId, sendAgain));
      if (!prepared.ok) return fail(prepared.error);
      if (prepared.preparedBefore) {
        setStatus(null);
        setPreparedBefore(true);
        return;
      }
      setStatus("Approve in your wallet…");
      setAwaitingWallet(true);
      /** A transaction the wallet reports late was still sent, so it is recorded; the server refuses it if the transfer got a new address since. */
      const txHash = await connected.pay(prepared.instruction);
      if (!txHash) throw new Error("The wallet did not return a transaction hash, so the transfer cannot be recorded.");
      setPreparedBefore(false);
      setSent({ txHash, paidTo: prepared.instruction.depositAddress });
      await record(txHash, prepared.instruction.depositAddress);
    } catch (cause) {
      if (run !== attempt.current) return;
      fail(walletErrorMessage(cause, "The wallet could not send the transfer."), walletErrorDetails(cause));
    } finally {
      if (run === attempt.current) {
        setAwaitingWallet(false);
        sendingRef.current = false;
      }
    }
  }

  /** Stops waiting for an unanswered wallet; the transfer counts as prepared, so the page offers recording a hash or sending again. */
  function stopWaiting() {
    attempt.current += 1;
    sendingRef.current = false;
    setAwaitingWallet(false);
    setStatus(null);
    setPreparedBefore(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body">
          Your wallet sent this transfer in transaction <span className="break-all font-mono text-meta">{sent.txHash}</span>. Solverr has not recorded it yet.
        </p>
        <ActionButton size="lg" className="w-full" pending={status !== null} pendingLabel={status} failed={error !== null} onClick={() => record(sent.txHash, sent.paidTo)}>
          Record the transaction
        </ActionButton>
        <ActionError message={error} details={errorDetails} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {preparedBefore ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface-2 p-4">
          <p className="text-body">You prepared this transfer before, so your wallet may already have sent it. If it did, paste the transaction hash to record it. If it did not, send it again.</p>
          <Field label="Transaction hash" htmlFor="transfer-tx">
            <Input id="transfer-tx" value={pastedHash} onChange={(event) => setPastedHash(event.target.value)} spellCheck={false} />
          </Field>
          <ActionButton variant="secondary" disabled={pastedHash.trim().length < 8} pending={status !== null} pendingLabel={status} onClick={() => record(pastedHash.trim())}>
            Record the transaction
          </ActionButton>
        </div>
      ) : null}
      {wallet ? (
        <>
          <p className="flex items-center gap-2 text-meta text-muted">
            <span className="size-2 rounded-full bg-success" aria-hidden />
            Connected <span className="font-mono text-fg">{short(wallet.address)}</span>
          </p>
          <ActionButton
            size="lg"
            variant={preparedBefore ? "danger" : "primary"}
            className="w-full"
            pending={status !== null}
            pendingLabel={status}
            failed={error !== null}
            failedLabel="Send again"
            onClick={() => send(wallet, preparedBefore)}
          >
            {preparedBefore ? "It was not sent: send again" : "Send from your wallet"}
          </ActionButton>
          {awaitingWallet ? (
            <Button variant="ghost" onClick={stopWaiting}>
              Stop waiting for the wallet
            </Button>
          ) : null}
        </>
      ) : (
        <WalletPicker
          kinds={[payoutKind]}
          signsMessages={false}
          onConnected={(connected) => {
            setError(null);
            setErrorDetails(null);
            setWallet(connected);
          }}
        />
      )}
      <ActionError message={error} details={errorDetails} />
    </div>
  );
}
