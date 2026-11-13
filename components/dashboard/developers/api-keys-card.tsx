"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { SecretReveal } from "@/components/dashboard/secret-reveal";
import { SectionCard } from "@/components/dashboard/section-card";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { EXPAND_MOTION, listItemMotion } from "@/components/ui/motion";
import { formatUtcDate } from "@/lib/format";
import { createApiKeyAction, revokeApiKeyAction } from "@/lib/merchants/actions/developers";

type ApiKeyRow = { id: string; last4: string; createdAt: string; revoked: boolean };

/** Room for three key rows, so the card keeps its size with no keys or one key; a list of keys reserves it only beside the webhook card (xl). */
const KEY_LIST_HEIGHT = "min-h-[210px]";

function KeyItem({ apiKey, delay, canManage }: { apiKey: ApiKeyRow; delay: number; canManage: boolean }) {
  const merchantId = useMerchantId();
  const { pending, error, run } = useAction();
  const masked = `sk_live_…${apiKey.last4}`;
  return (
    <m.li {...listItemMotion(delay)} className="flex min-h-[70px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
      <span className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
        <span className={`truncate font-mono text-body ${apiKey.revoked ? "text-muted line-through" : "font-medium"}`}>{masked}</span>
        <span className="text-meta text-muted">Created {formatUtcDate(apiKey.createdAt)}</span>
      </span>
      {apiKey.revoked ? (
        <Badge tone="muted">Revoked</Badge>
      ) : (
        <>
          <Badge tone="success">Active</Badge>
          {canManage ? (
            <ConfirmAction
              label="Revoke"
              confirmLabel="Revoke it"
              ariaLabel={`Revoke ${masked}`}
              pending={pending}
              error={error}
              onConfirm={() => run(() => revokeApiKeyAction(merchantId, apiKey.id))}
            />
          ) : null}
        </>
      )}
    </m.li>
  );
}

/** API keys: create a key (shown in full once) and revoke old ones. `canManage` is false for teammates: keys move real money. */
export function ApiKeysCard({ keys, canManage }: { keys: ApiKeyRow[]; canManage: boolean }) {
  const merchantId = useMerchantId();
  const { pending, done, error, failed, run } = useAction();
  const [secret, setSecret] = useState<string | null>(null);
  const active = keys.filter((key) => !key.revoked).length;

  return (
    <SectionCard
      icon="key"
      title="API keys"
      description={`${active} active ${active === 1 ? "key" : "keys"}. ${canManage ? "Each key is shown in full only once." : "Only the owner of this business can create or revoke them."}`}
      action={
        canManage ? (
          <ActionButton
            size="sm"
            pending={pending}
            done={done}
            doneLabel="Created"
            failed={failed}
            onClick={() =>
              run(
                () => createApiKeyAction(merchantId),
                (result) => setSecret(result.secret),
              )
            }
          >
            <Icon name="plus" className="size-4" />
            Create API key
          </ActionButton>
        ) : null
      }
    >
      <ActionError message={error} />
      <AnimatePresence initial={false}>
        {secret ? (
          <m.div key="secret" {...EXPAND_MOTION} className="overflow-hidden">
            <SecretReveal label="New API key" secret={secret} />
          </m.div>
        ) : null}
      </AnimatePresence>
      {keys.length === 0 ? (
        <p className={`grid flex-1 place-items-center rounded-[16px] border border-dashed border-line px-6 text-center text-meta text-muted ${KEY_LIST_HEIGHT}`}>
          No keys yet. Create one to call the Solverr API from your server.
        </p>
      ) : (
        <ul className="flex flex-1 flex-col xl:min-h-[210px]">
          <AnimatePresence initial={false}>
            {keys.map((key, index) => (
              <KeyItem key={key.id} apiKey={key} delay={index} canManage={canManage} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </SectionCard>
  );
}
