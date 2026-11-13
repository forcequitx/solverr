"use client";

import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { Field, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import { createSubscriptionAction } from "@/lib/merchants/actions/subscriptions";

type Interval = "week" | "month";

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** Whether Solverr emails customers their pay links: "off" when this server has no email configured. */
export type CustomerEmails = "on" | "off";

const EMAIL_NOTES: Record<CustomerEmails, string> = {
  on: " and emails the customer a payment link.",
  off: ". Email is not configured, so send the payment link yourself (it appears in Payments).",
};

/** Customer, amount and interval for a new subscription, with how invoices reach the customer. */
export function CreateSubscriptionForm({ customerEmails, currencies }: { customerEmails: CustomerEmails; currencies: readonly string[] }) {
  const merchantId = useMerchantId();
  const [form, setForm] = useState({ customer_email: "", amount: "", currency: currencies[0] ?? "USD", interval: "month" as Interval, description: "" });
  const { pending, done, error, failed, run } = useAction();
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <CardHeading
        icon="subscriptions"
        tint="blue"
        title="New subscription"
        description={
          <>
            Crypto cannot be pulled from a wallet, so each period Solverr creates an invoice
            {EMAIL_NOTES[customerEmails]}
          </>
        }
      />
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => createSubscriptionAction(merchantId, form),
            () => setForm({ ...form, customer_email: "", amount: "", description: "" }),
          );
        }}
      >
        <Field label="Customer email" htmlFor="sub-email">
          <Input id="sub-email" type="email" value={form.customer_email} onChange={set("customer_email")} required />
        </Field>
        <Field label="Description (optional)" htmlFor="sub-desc">
          <Input id="sub-desc" value={form.description} maxLength={200} onChange={set("description")} placeholder="Pro plan" />
        </Field>
        <Field label="Amount" htmlFor="sub-amount">
          <Input id="sub-amount" inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="9.00" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" htmlFor="sub-currency">
            <SearchSelect id="sub-currency" value={form.currency} options={currencies.map((code) => ({ value: code, label: code }))} onChange={(currency) => setForm({ ...form, currency })} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Every</p>
            <Segmented options={INTERVALS} value={form.interval} onChange={(interval) => setForm({ ...form, interval })} label="Invoice every" role="radiogroup" className="h-11! w-full" />
          </div>
        </div>
        <ActionButton type="submit" pending={pending} pendingLabel="Creating…" done={done} doneLabel="Created" failed={failed} className="sm:col-span-2 sm:min-w-[184px] sm:justify-self-start">
          Create subscription
        </ActionButton>
        {/** Reserved line so an error message never pushes the card taller. */}
        <div className="min-h-5 sm:col-span-2">
          <ActionError message={error} />
        </div>
      </form>
    </Card>
  );
}
