import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyableValue } from "@/components/dashboard/detail/copyable-value";
import { DetailList, DetailRow } from "@/components/dashboard/detail/detail-list";
import { FactCard } from "@/components/dashboard/detail/fact-card";
import { StatusTimeline } from "@/components/dashboard/detail/status-timeline";
import { ICON_ACTION } from "@/components/dashboard/list/list-styles";
import { PageHeader } from "@/components/dashboard/page-header";
import { TransferSigner } from "@/components/dashboard/transfers/transfer-signer";
import { TransferStatusBadge } from "@/components/dashboard/transfers/transfer-status";
import { transferTimeline } from "@/components/dashboard/transfers/transfer-timeline";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { Icon } from "@/components/ui/icon";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { requireMerchant } from "@/lib/auth/session";
import { chainForToken, explorerTxUrl, getChain } from "@/lib/chains/registry";
import { formatUsd, formatUtcDateTime } from "@/lib/format";
import { transferDetail } from "@/lib/merchants/transfer-stats";
import { displayTokens } from "@/lib/oneclick/tokens";
import { CancelTransfer } from "@/components/dashboard/transfers/cancel-transfer";
import { ReplaceTransferTx } from "@/components/dashboard/transfers/replace-transfer-tx";
import { KIND_LABELS, SPLIT_ON_HOLD, splitOnHold } from "@/lib/transfers/kinds";
import type { WalletKind } from "@/lib/wallets/client/types";

export default async function TransferPage({ params }: PageProps<"/dashboard/transfers/[id]">) {
  const { id } = await params;
  const { merchant, role } = await requireMerchant();
  const transfer = await transferDetail(merchant.id, id);
  if (!transfer) notFound();
  const editable = role !== "viewer";
  const onHold = splitOnHold(transfer);
  const tokens = await displayTokens();
  const [source, destination] = [transfer.sourceAsset, transfer.destinationAsset].map((assetId) => tokens.find((token) => token.assetId === assetId));
  const sourceChain = source ? chainForToken(source) : undefined;
  const destinationChain = destination ? chainForToken(destination) : undefined;
  const payoutChain = merchant.payoutChain ? getChain(merchant.payoutChain) : undefined;
  const converted = transfer.sourceAsset !== transfer.destinationAsset;
  const recipientGets = `${destination?.symbol ?? "the coin"} on ${destinationChain?.name ?? "its chain"}`;
  const txUrl = transfer.txHash && sourceChain ? explorerTxUrl(sourceChain, transfer.txHash) : null;

  return (
    <>
      <PageHeader
        title={KIND_LABELS[transfer.kind]}
        description={<CopyableValue value={transfer.id} ariaLabel="Copy transfer ID" />}
        action={
          transfer.invoiceId ? (
            <ButtonLink href={`/dashboard/payments/${transfer.invoiceId}`} variant="secondary" size="sm">
              Open the payment
              <Icon name="arrowRight" className="size-4" />
            </ButtonLink>
          ) : null
        }
      />

      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <FactCard icon="wallet" tint="blue" label="You send" value={`${transfer.amount} ${source?.symbol ?? ""}`.trim()} sub={sourceChain ? `On ${sourceChain.name}` : undefined} />
          <FactCard icon="transfers" tint="lime" label="Recipient gets" value={destination?.symbol ?? "—"} sub={`On ${destinationChain?.name ?? "—"} · ${converted ? "converted by NEAR Intents" : "direct transfer"}`} />
          <FactCard icon="activity" tint="blue" label="Status" value={<TransferStatusBadge status={transfer.status} />} sub={`Updated ${formatUtcDateTime(transfer.updatedAt)}`} />
          <FactCard icon="trendUp" tint="lime" label="Value now" value={source ? formatUsd(Number(transfer.amount) * source.price) : "—"} sub="At the current coin price" />
        </div>

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <CardHeading icon="activity" title="Timeline" description="Each step from preparing the transfer to the recipient." />
            <StatusTimeline steps={transferTimeline(transfer, { converted, recipientGets })} label="Transfer timeline" />
          </Card>

          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <CardHeading
              icon="wallet"
              tint="blue"
              title={transfer.status !== "pending" ? "Result" : editable ? "Approve and send" : "Waiting for approval"}
              description={
                transfer.status !== "pending"
                  ? "What happened to this transfer."
                  : editable
                    ? "Money only leaves from your own payout wallet."
                    : "The owner or a developer approves it from the payout wallet."
              }
            />

            {onHold ? (
              <OutcomeBanner tone="info" title="On hold">
                {SPLIT_ON_HOLD}
              </OutcomeBanner>
            ) : null}
            {transfer.status === "pending" && editable && !onHold ? (
              merchant.payoutAddress && payoutChain ? (
                <TransferSigner transferId={transfer.id} payoutKind={payoutChain.family as WalletKind} payoutAddress={merchant.payoutAddress} />
              ) : (
                <OutcomeBanner tone="warn" title="Payout wallet not verified">
                  {role === "owner" ? (
                    <>
                      Verify your payout wallet in{" "}
                      <Link href="/dashboard/settings" className="font-semibold underline">
                        Settings
                      </Link>{" "}
                      before sending refunds or payouts.
                    </>
                  ) : (
                    "Refunds and payouts can be sent once the owner verifies a payout wallet in Settings."
                  )}
                </OutcomeBanner>
              )
            ) : null}
            {transfer.status === "pending" && editable && !onHold ? <CancelTransfer transferId={transfer.id} depositAddress={transfer.depositAddress} /> : null}
            {transfer.status === "processing" ? (
              converted ? (
                <OutcomeBanner tone="info" title="Sent and converting">
                  NEAR Intents is converting the coins for the recipient. Reload this page to see the latest status.
                </OutcomeBanner>
              ) : (
                <OutcomeBanner tone="info" title="Sent, waiting for the network">
                  Solverr completes the transfer once the network confirms your transaction. Reload this page to see the latest status.
                </OutcomeBanner>
              )
            ) : null}
            {transfer.status === "processing" && !converted && editable ? <ReplaceTransferTx transferId={transfer.id} /> : null}
            {transfer.status === "completed" ? (
              <OutcomeBanner tone="success" title="Completed">
                The recipient got {recipientGets}.
              </OutcomeBanner>
            ) : null}
            {transfer.status === "failed" ? (
              <OutcomeBanner tone="danger" title="Failed">
                {transfer.failureReason ?? "The transfer did not complete."}
              </OutcomeBanner>
            ) : null}
            {transfer.status === "canceled" ? (
              <OutcomeBanner tone="warn" title="Canceled">
                The transfer was canceled before it was sent, so nothing left your wallet.
              </OutcomeBanner>
            ) : null}

            <DetailList>
              <DetailRow label="Recipient address">
                <CopyableValue value={transfer.recipient} ariaLabel="Copy recipient address" />
              </DetailRow>
              {converted && transfer.depositAddress ? (
                <DetailRow label="NEAR Intents deposit address">
                  <CopyableValue value={transfer.depositAddress} ariaLabel="Copy deposit address" />
                </DetailRow>
              ) : null}
              {transfer.depositMemo ? (
                <DetailRow label="Deposit memo">
                  <CopyableValue value={transfer.depositMemo} ariaLabel="Copy deposit memo" />
                </DetailRow>
              ) : null}
              {transfer.txHash ? (
                <DetailRow label="Your transaction">
                  <CopyableValue value={transfer.txHash} ariaLabel="Copy transaction hash" />
                  {txUrl ? (
                    <a href={txUrl} target="_blank" rel="noreferrer" aria-label="View your transaction in the explorer" title="View in the explorer" className={ICON_ACTION}>
                      <Icon name="arrowUpRight" className="size-4" />
                    </a>
                  ) : null}
                </DetailRow>
              ) : null}
              {transfer.batchId ? (
                <DetailRow label="Payout batch">
                  <CopyableValue value={transfer.batchId} ariaLabel="Copy batch ID" />
                </DetailRow>
              ) : null}
            </DetailList>
          </Card>
        </div>
      </div>
    </>
  );
}
