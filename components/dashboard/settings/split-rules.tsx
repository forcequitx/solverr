"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { MiddleEllipsis } from "@/components/dashboard/detail/middle-ellipsis";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { addSplitAction, removeSplitAction } from "@/lib/merchants/actions/splits";

/** `network` is where the recipient gets paid; `active` is false when it is not the current payout network, so the split is skipped. */
type Rule = { id: string; label: string; recipient: string; percent: string; network: string; active: boolean };

/** Room for two split rows, so the empty state matches a short list. */
const LIST_HEIGHT = "min-h-[140px]";

function RuleItem({ rule, delay, editable }: { rule: Rule; delay: number; editable: boolean }) {
  const merchantId = useMerchantId();
  const { pending, error, run } = useAction();
  return (
    <m.li {...listItemMotion(delay)} className="flex min-h-[70px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
      <span className="flex min-w-[12rem] flex-1 items-center gap-3">
        <InitialsAvatar text={rule.label} index={delay} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body font-medium">{rule.label}</span>
          <span className="flex min-w-0 gap-1 whitespace-nowrap text-meta text-muted">
            <span className="shrink-0">{rule.network} ·</span>
            <MiddleEllipsis value={rule.recipient} className="font-mono" />
          </span>
          {rule.active ? null : <span className="text-meta text-warn">Not paid: your payout network changed. Add it again with an address on the new network.</span>}
        </span>
        <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-meta font-semibold tabular-nums">{rule.percent}%</span>
      </span>
      {editable ? (
        <ConfirmAction
          label="Remove"
          confirmLabel="Remove"
          ariaLabel={`Remove the split for ${rule.label}`}
          pending={pending}
          error={error}
          onConfirm={() => run(() => removeSplitAction(merchantId, rule.id))}
        />
      ) : null}
    </m.li>
  );
}

export function SplitRules({ rules, editable }: { rules: Rule[]; editable: boolean }) {
  const merchantId = useMerchantId();
  const [form, setForm] = useState({ label: "", recipient: "", percent: "" });
  const { pending, done, error, failed, run } = useAction();
  /** Rounded to two decimals so shares such as 0.1% and 0.2% add up to 0.3%. */
  /** Rules for an earlier payout network are not paid, so they are not shared. */
  const total = Math.round(rules.filter((rule) => rule.active).reduce((sum, rule) => sum + Number(rule.percent), 0) * 100) / 100;
  const kept = Math.round(Math.max(0, 100 - total) * 100) / 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-meta text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--chart-2)]" />
            Shared <span className="font-semibold tabular-nums text-fg">{total}%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--chart-1)]" />
            Kept <span className="font-semibold tabular-nums text-fg">{kept}%</span>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Share of each payment that goes to splits"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={total}
          className="h-1.5 overflow-hidden rounded-full bg-[var(--chart-1)]"
        >
          <div className="h-full rounded-full bg-[var(--chart-2)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${Math.min(100, total)}%` }} />
        </div>
      </div>

      {rules.length === 0 ? (
        <p className={`grid place-items-center rounded-[16px] border border-dashed border-line px-6 text-center text-meta text-muted ${LIST_HEIGHT}`}>No splits. Every payment stays in your payout wallet.</p>
      ) : (
        <ul className={`flex flex-col ${LIST_HEIGHT}`}>
          <AnimatePresence initial={false}>
            {rules.map((rule, index) => (
              <RuleItem key={rule.id} rule={rule} delay={index} editable={editable} />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {editable ? (
        <form
          className="grid gap-3 rounded-[14px] border border-line p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_90px_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => addSplitAction(merchantId, form),
              () => setForm({ label: "", recipient: "", percent: "" }),
            );
          }}
        >
          <Field label="Name" htmlFor="split-label">
            <Input id="split-label" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Co-founder" />
          </Field>
          <Field label="Recipient wallet" htmlFor="split-recipient">
            <Input id="split-recipient" value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} spellCheck={false} />
          </Field>
          <Field label="Percent" htmlFor="split-percent">
            <Input id="split-percent" inputMode="decimal" value={form.percent} onChange={(event) => setForm({ ...form, percent: event.target.value })} placeholder="10" />
          </Field>
          <ActionButton type="submit" pending={pending} done={done} doneLabel="Added" failed={failed}>
            <Icon name="plus" className="size-4" />
            Add
          </ActionButton>
          <ActionError message={error} className="sm:col-span-4" />
        </form>
      ) : (
        <p className="text-meta text-muted">Only the owner of this business can change revenue splits.</p>
      )}
    </div>
  );
}
