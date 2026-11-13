"use client";

import { useState } from "react";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi } from "@/components/checkout/checkout-api";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Field, Input } from "@/components/ui/field";
import { format } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";

/** Optional receipt email; once saved, the field locks and a line names it, since the server keeps only the first email. */
export function ReceiptEmail({ invoiceId, onSaved }: { invoiceId: string; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = messages.receiptEmail;
  const saved = savedEmail !== null;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (saved) return;
        setBusy(true);
        setError(null);
        try {
          const value = email.trim();
          await checkoutApi.saveReceiptEmail(invoiceId, value);
          setSavedEmail(value);
          onSaved();
        } catch (cause) {
          setError(apiErrorText(cause, messages, { fallback: m.saveFailed }));
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-2"
    >
      <Field label={m.label} htmlFor="receipt-email">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="receipt-email" type="email" placeholder={m.placeholder} value={email} readOnly={saved} onChange={(event) => setEmail(event.target.value)} />
          <ActionButton
            type="submit"
            variant="secondary"
            pending={busy}
            disabled={!email.trim()}
            done={saved}
            doneLabel={m.savedLabel}
            failed={error !== null}
            failedLabel={messages.results.tryAgain}
          >
            {m.save}
          </ActionButton>
        </div>
      </Field>
      <ActionError message={error} />
      {savedEmail ? (
        <p role="status" className="text-meta text-muted [overflow-wrap:anywhere]">
          {format(m.saved, { email: savedEmail })}
        </p>
      ) : null}
    </form>
  );
}
