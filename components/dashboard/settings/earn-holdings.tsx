"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { CoinIcon } from "@/components/ui/coin-icon";
import { formatUsd } from "@/lib/format";
import { withdrawEarnAction } from "@/lib/merchants/actions/settlement";
import type { EarnHolding } from "@/lib/payments/earn-holdings";

/** Earn vault shares with a Withdraw button each; `unreadable` means some balances could not be read, so missing shares are not called none. */
export function EarnHoldings({ holdings, unreadable, editable }: { holdings: EarnHolding[]; unreadable: boolean; editable: boolean }) {
  const router = useRouter();
  const merchantId = useMerchantId();
  /** The vault whose withdrawal ran last; its button stays busy until the withdrawal page opens. */
  const [chosen, setChosen] = useState<string | null>(null);
  const withdrawal = useAction();
  if (holdings.length === 0) {
    return (
      <p className="rounded-[16px] border border-dashed border-line px-6 py-8 text-center text-sm text-muted">
        {unreadable ? "Your Earn balances could not be read right now. Reload this page in a moment." : "Your payout wallet holds no Earn vault shares."}
      </p>
    );
  }

  const withdraw = (holding: EarnHolding) => {
    setChosen(holding.assetId);
    withdrawal.run(
      () => withdrawEarnAction(merchantId, holding.assetId),
      (result) => router.push(`/dashboard/transfers/${result.id}`),
    );
  };
  const errorFor = (holding: EarnHolding) => (chosen === holding.assetId ? withdrawal.error : null);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line text-body">
        {holdings.map((holding) => (
          <li key={holding.assetId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex min-w-0 items-center gap-3">
              <CoinIcon symbol={holding.symbol} className="size-9 text-xs" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{holding.vault}</span>
                <span className="block truncate text-meta text-muted">
                  {holding.amount} {holding.symbol} · ≈ {formatUsd(holding.usd)} · Provider: {holding.provider}
                </span>
              </span>
            </span>
            {editable ? (
              <ActionButton
                size="sm"
                variant="secondary"
                disabled={withdrawal.pending}
                pending={withdrawal.pending && chosen === holding.assetId}
                pendingLabel="Preparing…"
                failed={errorFor(holding) !== null}
                onClick={() => withdraw(holding)}
              >
                Withdraw to USDC
              </ActionButton>
            ) : null}
            <ActionError message={errorFor(holding)} className="basis-full text-right" />
          </li>
        ))}
      </ul>
      {unreadable ? <p className="text-meta text-warn">Some Earn balances could not be read right now, so this list may be incomplete. Reload this page in a moment.</p> : null}
      <p className="text-meta text-muted">Yield and principal are not guaranteed by Solverr or NEAR Intents. Withdrawing swaps the shares back to USDC in your own wallet.</p>
    </div>
  );
}
