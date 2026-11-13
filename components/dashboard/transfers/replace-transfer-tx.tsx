"use client";

import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Field, Input } from "@/components/ui/field";
import { reportTransferAction } from "@/lib/merchants/actions/transfers";

/** Records a sped-up or replacement transaction; the replaced one never confirms, so the transfer would otherwise fail although it was sent. */
export function ReplaceTransferTx({ transferId }: { transferId: string }) {
  const merchantId = useMerchantId();
  const [hash, setHash] = useState("");
  const { pending, done, failed, error, run } = useAction();
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line px-4 py-3">
      <p className="text-sm text-muted">Did your wallet speed up or replace this transaction? Paste the new transaction hash so Solverr follows that one.</p>
      <Field label="New transaction hash" htmlFor="replacement-tx">
        <Input id="replacement-tx" value={hash} onChange={(event) => setHash(event.target.value)} spellCheck={false} />
      </Field>
      <ActionButton
        variant="secondary"
        disabled={hash.trim().length < 8}
        pending={pending}
        done={done}
        doneLabel="Recorded"
        failed={failed}
        onClick={() => run(() => reportTransferAction(merchantId, transferId, hash.trim()))}
      >
        Record the new transaction
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
