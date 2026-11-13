"use client";

import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Field, Input } from "@/components/ui/field";
import { updateProfileAction } from "@/lib/merchants/actions/account";

export function ProfileForm({ name, website }: { name: string; website: string }) {
  const merchantId = useMerchantId();
  const [values, setValues] = useState({ name, website });
  const { pending, done, error, failed, run } = useAction();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateProfileAction(merchantId, values));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="profile-name">
          <Input id="profile-name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        </Field>
        <Field label="Website" htmlFor="profile-website">
          <Input id="profile-website" type="url" value={values.website} onChange={(event) => setValues({ ...values, website: event.target.value })} placeholder="https://" />
        </Field>
      </div>
      <div className="flex flex-col items-start gap-2">
        <ActionButton type="submit" pending={pending} done={done} failed={failed} className="w-full sm:w-auto">
          Save
        </ActionButton>
        <ActionError message={error} />
      </div>
    </form>
  );
}
