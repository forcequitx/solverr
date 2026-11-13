"use client";

import NumberFlow from "@number-flow/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi } from "@/components/checkout/checkout-api";
import { CheckoutFooter } from "@/components/checkout/checkout-footer";
import { embedderOrigin, useEmbedEscape } from "@/components/checkout/embed-escape";
import { DECK_BUTTON, StackedCards, StackedNotice } from "@/components/checkout/stacked-cards";
import { Badge } from "@/components/ui/badge";
import { BandLayout } from "@/components/ui/band-layout";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { MerchantMark } from "@/components/ui/merchant-mark";
import { Spinner } from "@/components/ui/spinner";
import { shortAmountFormat } from "@/lib/format";
import { format } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";
import { FIAT_AMOUNT_MAX, FIAT_AMOUNT_PATTERN } from "@/lib/money";

const BUTTON_FACE = "col-start-1 row-start-1 inline-flex items-center justify-center gap-2 transition-[translate,opacity] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]";

/** Query string of the embedded checkout page; it repeats the opener's origin so a full page load still knows where to post. */
function embedQuery(): string {
  const origin = embedderOrigin();
  return origin ? `?embed=1&origin=${encodeURIComponent(origin)}` : "?embed=1";
}

/** Payment link landing step: fixed links continue straight to checkout; links without a fixed amount ask for it in the tray first. */
export function PaymentLinkForm({
  linkId,
  merchantName,
  logoUrl,
  amount,
  currency,
  testMode,
  embedded,
}: {
  linkId: string;
  merchantName: string;
  logoUrl: string | null;
  amount: string | null;
  currency: string;
  testMode: boolean;
  embedded: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = messages.paymentLink;
  /** A comma before exactly three digits groups thousands ("1,500"); a comma left after that, as typed in many languages, is a decimal point. */
  const typed = chosen.trim().replace(/,(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amountValid = FIAT_AMOUNT_PATTERN.test(typed) && Number(typed) > 0;
  useEmbedEscape(embedded);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await checkoutApi.startPaymentLink(linkId, amount ? null : typed);
      /** The button stays busy while the checkout page opens. */
      router.push(`/pay/${invoice.id}${embedded ? embedQuery() : ""}`);
    } catch (cause) {
      setError(apiErrorText(cause, messages));
      setBusy(false);
    }
  }

  /** A fixed price is the real figure from the server HTML on, never 0.00 before the page's script runs. */
  const total = amount ? Number(amount) : amountValid ? Number(typed) : 0;
  const empty = !amount && !amountValid;

  return (
    <BandLayout
      band={
        <div className="flex animate-card-grow flex-col items-center gap-2">
          <MerchantMark name={merchantName} logoUrl={logoUrl} variant="hero" />
          <p className="font-heading text-[17px] leading-snug font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] @xl:text-lg">{merchantName}</p>
          {testMode ? <Badge tone="warn">{messages.common.demo}</Badge> : null}
        </div>
      }
      footer={<CheckoutFooter embedded={embedded} />}
    >
      <StackedCards
        tone="accent"
        front={
          <>
            <h1 className="font-heading text-[12.5px] leading-none font-bold tracking-[0.14em] text-muted uppercase">{amount ? messages.checkout.amountDue : m.chooseAmount}</h1>
            <p className="flex max-w-full flex-wrap items-baseline justify-center gap-x-[0.2em] font-heading text-[clamp(30px,12cqi,56px)] leading-none font-bold tracking-[-0.04em] tabular-nums">
              <NumberFlow value={total} format={shortAmountFormat(total)} locales="en-US" className={`whitespace-nowrap transition-opacity ${empty ? "opacity-40" : ""}`} />
              <span className="text-[0.4em] font-semibold tracking-normal text-muted">{currency}</span>
            </p>
          </>
        }
        actions={
          <Button
            size="lg"
            className={`group col-span-2 overflow-hidden aria-busy:opacity-100! ${DECK_BUTTON}`}
            disabled={busy || empty}
            aria-busy={busy || undefined}
            onClick={start}
          >
            <span className="grid">
              <span aria-hidden={busy || undefined} className={`${BUTTON_FACE} ${busy ? "-translate-y-[140%] opacity-0" : ""}`}>
                {m.continue}
                <Icon name="arrowRight" className="size-4 transition-transform duration-200 group-hover:translate-x-[3px]" />
              </span>
              <span aria-hidden={!busy || undefined} className={`${BUTTON_FACE} ${busy ? "" : "translate-y-[140%] opacity-0"}`}>
                <Spinner />
                {m.opening}
              </span>
            </span>
          </Button>
        }
      >
        {amount ? null : (
          <Field label={format(m.amountLabel, { currency })} htmlFor="amount" hint={m.amountHint} error={error ?? (typed && !amountValid ? format(m.amountInvalid, { max: FIAT_AMOUNT_MAX }) : null)} announce={error !== null}>
            <div className="relative">
              <Input
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                onKeyDown={(event) => {
                  /** Enter continues like the button, since the card is not a form. */
                  if (event.key !== "Enter" || busy || empty) return;
                  event.preventDefault();
                  void start();
                }}
                className="h-12! pr-20!"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg bg-surface-2 px-2.5 py-1.5 font-heading text-[13px] font-semibold text-muted"
              >
                {currency}
              </span>
            </div>
          </Field>
        )}
      </StackedCards>
      {amount && error ? (
        <div className="mx-auto w-full max-w-[460px]">
          <StackedNotice tone="warn">{error}</StackedNotice>
        </div>
      ) : null}
    </BandLayout>
  );
}
