"use client";

import { BandTrack, type TrackStepState } from "@/components/ui/band-track";
import type { CheckoutMessages } from "@/lib/i18n/messages/en";
import { toBaseUnits } from "@/lib/money";
import type { CheckoutState } from "@/lib/payments/checkout-state";

const STEP_KEYS = ["waiting", "detected", "converting", "paid"] as const;

type StatusStep = { key: (typeof STEP_KEYS)[number]; state: TrackStepState; label: string };

type StatusView = {
  steps: StatusStep[];
  /** Index of the furthest step that has started, or -1 before the customer has an address. */
  current: number;
  progressLabel: string;
};

/** State of the four payment steps (none started before an address exists); `flowing` while the customer can still pay, `sent` after
    a wallet payment was sent, `addressExpired` once the open address's time ran out. */
export function paymentStatusView(state: CheckoutState, flow: { flowing: boolean; sent: boolean; addressExpired: boolean }, m: CheckoutMessages): StatusView {
  const states: TrackStepState[] = ["todo", "todo", "todo", "todo"];
  const payment = state.payment;

  if (flow.flowing) {
    if (payment?.state === "active") states[0] = !flow.sent && flow.addressExpired ? "warn" : "cur";
  } else {
    states[0] = "done";
    switch (state.status) {
      case "detected":
        states[1] = "cur";
        break;
      case "processing":
        states[1] = "done";
        states[2] = "cur";
        break;
      case "paid":
        states[1] = states[2] = states[3] = "done";
        break;
      case "underpaid":
        states[1] = "warn";
        break;
      case "refunded": {
        const tooLow = !!payment?.deposited_amount && toBaseUnits(payment.deposited_amount, payment.coin.decimals) < BigInt(payment.min_amount_in_base);
        states[1] = tooLow ? "warn" : "done";
        states[2] = "warn";
        break;
      }
      case "failed":
        states[1] = "done";
        states[2] = "bad";
        break;
      default:
        states[0] = "bad";
    }
  }

  return {
    /** A finished first step reads "Sent": "Waiting" with a check would read as still waiting. */
    steps: STEP_KEYS.map((key, index) => ({ key, state: states[index], label: key === "waiting" && states[index] === "done" ? m.paymentStatus.sent : m.paymentStatus.steps[key] })),
    current: states.reduce((last, step, index) => (step !== "todo" ? index : last), -1),
    progressLabel: m.paymentStatus.progressLabel,
  };
}

/** The four payment steps as dots on a line across the accent band; the line fills up to the current step. */
export function StatusTrack({ view }: { view: StatusView }) {
  return (
    <BandTrack
      steps={view.steps}
      current={view.current}
      label={view.progressLabel}
      className="max-w-[540px]"
    />
  );
}
