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
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { EXPAND_MOTION } from "@/components/ui/motion";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { sendPingWebhookAction, setWebhookAction } from "@/lib/merchants/actions/developers";
import { WEBHOOKS_OFF_MESSAGE } from "@/lib/webhooks/endpoint";

/** Webhook endpoint: save or clear the URL, send a ping, rotate the signing secret (shown once). `disabled`: it answered 410 Gone and gets
    nothing until the URL is saved again. `canManage` is false for teammates, `canPing` false for viewers. */
export function WebhookCard({ webhookUrl, disabled, canManage, canPing }: { webhookUrl: string; disabled: boolean; canManage: boolean; canPing: boolean }) {
  const merchantId = useMerchantId();
  const save = useAction();
  const ping = useAction();
  const rotate = useAction();
  const [url, setUrl] = useState(webhookUrl);
  const [secret, setSecret] = useState<string | null>(null);
  const keepSecret = (result: { secret?: string }) => {
    if (result.secret) setSecret(result.secret);
  };

  return (
    <SectionCard
      icon="webhook"
      tint="blue"
      title="Webhook"
      description="Signed events, such as invoice.paid, sent to your server."
      action={disabled ? <Badge tone="warn">Stopped</Badge> : webhookUrl ? <Badge tone="success">On</Badge> : <Badge tone="muted">Off</Badge>}
    >
      {disabled ? <OutcomeBanner tone="warn" title="Webhooks stopped">{WEBHOOKS_OFF_MESSAGE}</OutcomeBanner> : null}

      {canManage ? (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            /** Enter in an emptied field must not turn webhooks off; that goes through the confirm button only. */
            if (url.trim() === "" && webhookUrl) return;
            save.run(() => setWebhookAction(merchantId, { url }), keepSecret);
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Endpoint URL (https)" htmlFor="webhook-url" error={save.error} hint="Clear the URL to turn webhooks off.">
              <Input id="webhook-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://shop.example/webhooks/solverr" />
            </Field>
          </div>
          {/** Turning webhooks off deletes the signing secret and stops waiting events, which saving again cannot undo, so it asks first. */}
          {url.trim() === "" && webhookUrl ? (
            <div className="sm:mt-[26px]">
              <ConfirmAction
                label="Turn webhooks off"
                confirmLabel="Turn off"
                ariaLabel="Turn webhooks off and delete the signing secret"
                pending={save.pending}
                onConfirm={() => save.run(() => setWebhookAction(merchantId, { url: "" }), keepSecret)}
              />
            </div>
          ) : (
            <ActionButton type="submit" pending={save.pending} done={save.done} failed={save.failed} className="sm:mt-[26px]">
              Save
            </ActionButton>
          )}
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="break-all font-mono text-body">{webhookUrl || "No endpoint set"}</p>
          <p className="text-meta text-muted">Only the owner of this business can change the webhook.</p>
        </div>
      )}

      <AnimatePresence initial={false}>
        {secret ? (
          <m.div key="secret" {...EXPAND_MOTION} className="overflow-hidden">
            <SecretReveal label="Webhook signing secret" secret={secret} />
          </m.div>
        ) : null}
      </AnimatePresence>

      <p className="rounded-[14px] bg-surface-2 p-4 text-meta text-muted">
        Requests are signed the Standard Webhooks way: <code className="font-mono text-fg">webhook-signature</code> holds{" "}
        <code className="font-mono text-fg">v1,</code> and the base64 HMAC-SHA256 of <code className="font-mono text-fg">id.timestamp.body</code>, so any Standard
        Webhooks library can verify them. After you rotate the secret, the old one keeps signing beside the new one for 24 hours.
      </p>

      {webhookUrl && !disabled && canPing ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <ActionButton
            variant="secondary"
            size="sm"
            pending={ping.pending}
            done={ping.done}
            doneLabel="Sent"
            failed={ping.failed}
            onClick={() => ping.run(() => sendPingWebhookAction(merchantId))}
          >
            <Icon name="arrowUpRight" className="size-4" />
            Send ping event
          </ActionButton>
          {canManage ? (
            <ConfirmAction
              /** Each rotated secret remounts the confirm control, so the next rotation asks again. */
              key={secret ?? "none"}
              label="Rotate signing secret"
              confirmLabel="Rotate it"
              ariaLabel="Rotate the webhook signing secret"
              pending={rotate.pending}
              error={rotate.error}
              onConfirm={() => rotate.run(() => setWebhookAction(merchantId, { url: webhookUrl, rotate: true }), keepSecret)}
            />
          ) : null}
          <ActionError message={ping.error} className="basis-full" />
        </div>
      ) : null}
    </SectionCard>
  );
}
