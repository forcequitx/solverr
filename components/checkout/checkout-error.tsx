"use client";

import { useParams, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import { useEmbedEscape } from "@/components/checkout/embed-escape";
import { helpLinkProps } from "@/components/checkout/help-link";
import { DECK_BUTTON, StackedResult } from "@/components/checkout/stacked-cards";
import { Button, ButtonLink } from "@/components/ui/button";
import { errorDigest } from "@/components/ui/error-screen";
import { formatNodes } from "@/lib/i18n/interpolate";
import { en } from "@/lib/i18n/messages/en";

const messages = en.errors;

/** Whether the page is the embedded checkout (`?embed=1`). */
function useEmbedded(): boolean {
  return useSearchParams().get("embed") === "1";
}

/** "Get help with a payment", full width under the stack, naming the payment when there is one. */
function HelpButton({ primary }: { primary: boolean }) {
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const embedded = useEmbedded();
  return (
    <ButtonLink
      {...helpLinkProps(invoiceId, embedded)}
      variant={primary ? "primary" : "secondary"}
      size="lg"
      className={`col-span-2 ${DECK_BUTTON} ${primary ? "" : "border-[1.5px]!"}`}
    >
      {messages.getHelp}
    </ButtonLink>
  );
}

/** A customer payment page that cannot be shown: the logo above a stacked card, with an optional line under it. */
function CheckoutProblemPage({ children, footnote }: { children: ReactNode; footnote?: ReactNode }) {
  const embedded = useEmbedded();
  useEmbedEscape(embedded);
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-5 px-4 py-8">
      <LogoMark className="size-10" />
      {children}
      {footnote}
    </main>
  );
}

/** Error screen for the customer payment pages. */
export function CheckoutError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <CheckoutProblemPage
      footnote={
        digest ? <p className="max-w-[460px] text-center text-meta break-all text-muted">{formatNodes(messages.referenceCode, { code: <span className="font-mono">{digest}</span> })}</p> : null
      }
    >
      <StackedResult
        tone="danger"
        icon="alert"
        title={messages.title}
        titleAs="h1"
        alert
        lead={<p className="text-[15px] leading-relaxed text-pretty">{messages.message}</p>}
        actions={
          <>
            <Button size="lg" className={`col-span-2 ${DECK_BUTTON}`} onClick={retry}>
              {messages.tryAgain}
            </Button>
            <HelpButton primary={false} />
          </>
        }
      />
    </CheckoutProblemPage>
  );
}

/** Shown for a payment or payment link that does not exist or was turned off. */
export function CheckoutNotFound() {
  return (
    <CheckoutProblemPage>
      <StackedResult
        tone="muted"
        icon="chain"
        title={messages.notFoundTitle}
        titleAs="h1"
        alert
        lead={<p className="text-[15px] leading-relaxed text-pretty">{messages.notFoundMessage}</p>}
        actions={<HelpButton primary />}
      />
    </CheckoutProblemPage>
  );
}
