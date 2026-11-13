"use client";

import { useState } from "react";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi } from "@/components/checkout/checkout-api";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { en as messages } from "@/lib/i18n/messages/en";

const OUTCOMES = ["paid", "underpaid", "refunded", "failed"] as const;
const DOTS: Record<(typeof OUTCOMES)[number], string> = { paid: "bg-success", underpaid: "bg-warn", refunded: "bg-info", failed: "bg-danger" };

/** Test mode only: walks the open test payment to an outcome without money; the pressed outcome spins until the page moves on. */
export function SimulatePanel({ invoiceId, onSimulated }: { invoiceId: string; onSimulated: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<(typeof OUTCOMES)[number] | null>(null);
  const m = messages.simulate;
  return (
    <div className="flex flex-col gap-2.5 rounded-[22px] bg-warn-bg p-[18px] text-warn">
      <p className="flex items-center gap-2 font-heading text-[14.5px] font-semibold">
        <Icon name="flask" className="size-4 shrink-0" />
        {m.title}
      </p>
      <p className="text-meta">{m.ready}</p>
      <div className="mt-0.5 grid grid-cols-2 gap-2">
        {OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            type="button"
            disabled={pending !== null}
            aria-busy={pending === outcome || undefined}
            className={`flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-surface font-heading text-[14.5px] font-semibold text-fg transition-[background-color,scale,opacity] duration-150 hover:bg-surface-2 ${FOCUS_RING} active:scale-[0.97] disabled:cursor-default disabled:opacity-60 aria-busy:opacity-100!`}
            onClick={async () => {
              setPending(outcome);
              setMessage(null);
              try {
                await checkoutApi.simulate(invoiceId, outcome);
                await onSimulated();
              } catch (cause) {
                setPending(null);
                setMessage(apiErrorText(cause, messages, { fallback: m.failed }));
              }
            }}
          >
            {pending === outcome ? <Spinner className="size-3.5" /> : <span aria-hidden="true" className={`size-2.5 rounded-full ${DOTS[outcome]}`} />}
            {m.outcomes[outcome]}
          </button>
        ))}
      </div>
      {message ? <p className="text-meta text-danger">{message}</p> : null}
    </div>
  );
}
