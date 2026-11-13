"use client";

import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { Field, FieldAction, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { createPaymentLinkAction } from "@/lib/merchants/actions/links";

/** Title, optional amount and currency for a new payment link; the new link appears in the list below. */
export function CreateLinkForm({ currencies }: { currencies: readonly string[] }) {
  const merchantId = useMerchantId();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [returnUrl, setReturnUrl] = useState("");
  const { pending, done, error, failed, run } = useAction();

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <CardHeading icon="plus" tint="blue" title="New payment link" description="Leave the amount empty for a tip or donation link where the customer chooses how much to pay." />
      <form
        className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_150px_140px] xl:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => createPaymentLinkAction(merchantId, { title, amount, currency, redirect_url: returnUrl }),
            () => {
              setTitle("");
              setAmount("");
              setReturnUrl("");
            },
          );
        }}
      >
        <Field label="What is it for?" htmlFor="link-title">
          <Input id="link-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Flat white" required />
        </Field>
        <Field label="Amount" htmlFor="link-amount">
          <Input id="link-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Customer chooses" />
        </Field>
        <Field label="Currency" htmlFor="link-currency">
          <SearchSelect id="link-currency" value={currency} options={currencies.map((code) => ({ value: code, label: code }))} onChange={setCurrency} />
        </Field>
        <div className="xl:col-span-2">
          <Field label="After payment, send customers to (optional)" htmlFor="link-return" hint="Leave it empty to send them to your business website, if one is set in Settings.">
            <Input id="link-return" type="url" inputMode="url" value={returnUrl} onChange={(event) => setReturnUrl(event.target.value)} placeholder="https://shop.example/thanks" />
          </Field>
        </div>
        <FieldAction from="xl">
          <ActionButton type="submit" pending={pending} pendingLabel="Creating…" done={done} doneLabel="Created" failed={failed} disabled={!title.trim() && !done} className="w-full">
            Create link
          </ActionButton>
        </FieldAction>
      </form>
      {/** Reserved line so an error message never pushes the card taller. */}
      <div className="-mt-2 min-h-5">
        <ActionError message={error} />
      </div>
    </Card>
  );
}
