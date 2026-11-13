"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Field } from "@/components/ui/field";
import { EXPAND_MOTION } from "@/components/ui/motion";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { RECOMMENDED, SearchSelect } from "@/components/ui/search-select";
import { Switch } from "@/components/ui/switch";
import { setSettlementAction } from "@/lib/merchants/actions/settlement";
import type { SettlementCheck } from "@/lib/merchants/settlement-check";
import type { SettlementOption } from "@/lib/merchants/settlement-options";
import { formatMinimumUsd } from "@/lib/money";

/** The coin the business receives and the private-payments choice. With `id` there is no Save button: a button elsewhere
    submits it with `form={id}`, and `action` lets that button show the saving state. */
export function SettlementForm({
  merchantId,
  id,
  options,
  current,
  recommended = null,
  checkPayout = null,
  privatePayments,
  privateUnavailable,
  action,
  onSaved,
}: {
  /** The business the page shows; the server refuses the change if another one is selected since. */
  merchantId: string;
  id?: string;
  options: SettlementOption[];
  current: string;
  /** The coin tagged "Recommended", from the worker's measured route data; null when the data cannot tell. */
  recommended?: string | null;
  /** The verified payout wallet (network and address) to check each selected coin against with NEAR Intents, warning when it refuses
      small payments; onboarding only, and the check runs again when the wallet changes. */
  checkPayout?: string | null;
  privatePayments: boolean;
  /** Why this server cannot serve private payments, or null when it can; the switch can then only be turned off. */
  privateUnavailable: string | null;
  action?: ReturnType<typeof useAction>;
  onSaved?: () => void;
}) {
  const [assetId, setAssetId] = useState(options.some((o) => o.assetId === current) ? current : (options[0]?.assetId ?? ""));
  const [isPrivate, setIsPrivate] = useState(privatePayments);
  const ownAction = useAction();
  const { pending, done, error, failed, run } = action ?? ownAction;
  const selected = options.find((o) => o.assetId === assetId);
  /** NEAR Intents' current answer for small payments into the selected coin, checked whenever the selection changes. */
  const [check, setCheck] = useState<{ assetId: string; result: SettlementCheck } | null>(null);

  useEffect(() => {
    if (!checkPayout || !assetId) return;
    const controller = new AbortController();
    /** A route handler instead of a server action, so this check never queues Save or Next behind it. */
    fetch(`/api/settlement-check?merchant_id=${encodeURIComponent(merchantId)}&asset_id=${encodeURIComponent(assetId)}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ check: SettlementCheck | null }>) : null))
      .then(
        (body) => {
          if (!controller.signal.aborted && body?.check) setCheck({ assetId, result: body.check });
        },
        () => {},
      );
    return () => controller.abort();
  }, [checkPayout, merchantId, assetId]);
  const refusal = check?.assetId === assetId && check.result.refused ? check.result : null;
  const canTogglePrivate = !privateUnavailable || isPrivate;

  return (
    <form
      id={id}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => setSettlementAction(merchantId, { assetId, privatePayments: isPrivate }), onSaved);
      }}
    >
      <Field label="Coin you receive" htmlFor="settlement-coin" hint="Customers can pay with any coin; it is converted to this one.">
        <SearchSelect
          id="settlement-coin"
          value={assetId}
          options={options.map((option) => ({ value: option.assetId, label: option.label, tag: option.assetId === recommended ? RECOMMENDED : undefined }))}
          onChange={setAssetId}
        />
      </Field>
      <AnimatePresence initial={false}>
        {options.length === 0 ? (
          <m.div key="no-coins" {...EXPAND_MOTION} className="overflow-hidden">
            <OutcomeBanner tone="warn" title="The coins you can receive could not be loaded.">
              NEAR Intents did not answer. Reload this page in a moment.
            </OutcomeBanner>
          </m.div>
        ) : null}
        {refusal && selected ? (
          <m.div key="refused" {...EXPAND_MOTION} className="overflow-hidden">
            <OutcomeBanner
              tone="warn"
              title={
                refusal.minimumUsd
                  ? `NEAR Intents currently refuses payments under ${formatMinimumUsd(Number(refusal.minimumUsd))} into ${selected.label}.`
                  : `NEAR Intents cannot deliver payments into ${selected.label} right now.`
              }
            >
              Customers who pay less cannot complete their payment. Choose another coin, or verify a payout wallet on another network.
            </OutcomeBanner>
          </m.div>
        ) : null}
        {privateUnavailable && isPrivate ? (
          <m.div key="private" {...EXPAND_MOTION} className="overflow-hidden">
            <OutcomeBanner tone="warn" title="Customers cannot pay while private payments are on.">
              {privateUnavailable} Turn private payments off and save, so customers can pay again.
            </OutcomeBanner>
          </m.div>
        ) : null}
        {selected?.earn ? (
          <m.div key="earn" {...EXPAND_MOTION} className="overflow-hidden">
            <OutcomeBanner tone="warn" title="Yield and principal are not guaranteed">
              Earn puts each payment into a third-party yield vault. The vault shares stay in your own wallet and you can withdraw them any time by swapping them back.
            </OutcomeBanner>
          </m.div>
        ) : null}
      </AnimatePresence>
      {/** Clicking anywhere in the tile toggles the switch, as the label's first labelable control. */}
      <label className={`flex items-start gap-3 rounded-[14px] border border-line p-4 text-body ${canTogglePrivate ? "cursor-pointer" : ""}`}>
        <span className={`min-w-0 flex-1 ${canTogglePrivate ? "" : "opacity-60"}`}>
          <span className="font-heading font-semibold">Private payments</span>
          <span className="mt-0.5 block text-meta text-muted">
            Hide the link between each customer payment and the money you receive, so they cannot be matched on the blockchain.
            {privateUnavailable && !isPrivate ? ` ${privateUnavailable}` : null}
          </span>
        </span>
        <Switch checked={isPrivate} onChange={setIsPrivate} label="Private payments" disabled={!canTogglePrivate} />
      </label>
      {id ? (
        /** The submitting button sits elsewhere, so the reason shows here in red. */
        <ActionError message={error} tone="danger" />
      ) : (
        <div className="flex flex-col items-start gap-2">
          <ActionButton type="submit" disabled={options.length === 0} pending={pending} done={done} failed={failed} className="w-full sm:w-auto">
            Save
          </ActionButton>
          <ActionError message={error} />
        </div>
      )}
    </form>
  );
}
