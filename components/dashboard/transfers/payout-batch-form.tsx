"use client";

import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { createPayoutsAction } from "@/lib/merchants/actions/transfers";

const CREATED_MS = 2400;

export function PayoutBatchForm({ exampleAsset }: { exampleAsset: string }) {
  const merchantId = useMerchantId();
  const [csv, setCsv] = useState("");
  const { pending, error, failed, run } = useAction();
  /** How many payouts the last run created, shown in the button for a moment. */
  const [created, setCreated] = useState<number | null>(null);

  const create = () => {
    setCreated(null);
    run(
      () => createPayoutsAction(merchantId, csv),
      (result) => {
        setCreated(result.count);
        setTimeout(() => setCreated(null), CREATED_MS);
        setCsv("");
      },
    );
  };

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <CardHeading icon="plus" tint="blue" title="New payouts" description="Paste one payout per line." />
      <p className="text-meta text-muted">
        Each line is <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-fg">recipient,asset_id,amount</code>. The amount is in the coin you receive, and <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-fg">asset_id</code> is the coin the recipient gets (the example uses the coin you receive). Every row is checked
        before any payout is created; you then approve each one from your wallet.
      </p>
      <label className="flex flex-1 flex-col">
        <span className="sr-only">Payout rows</span>
        <textarea
          className="min-h-32 flex-1 resize-none rounded-control border border-line bg-surface p-3 font-mono text-field placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={`0xRecipientAddress,${exampleAsset},25.00`}
          spellCheck={false}
          disabled={pending}
        />
      </label>
      <div className="flex flex-col items-start gap-2">
        <ActionButton
          className="w-full sm:w-auto"
          disabled={!csv.trim() && created === null}
          pending={pending}
          pendingLabel="Checking rows…"
          done={created !== null}
          doneLabel={`${created ?? 0} created · approve below`}
          failed={failed}
          onClick={create}
        >
          Create payouts
        </ActionButton>
        <ActionError message={error} />
      </div>
    </Card>
  );
}
