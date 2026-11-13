"use client";

import { LogoMark } from "@/components/brand/logo";
import { helpLinkProps } from "@/components/checkout/help-link";
import { en } from "@/lib/i18n/messages/en";

/** Help link (for `invoiceId` when set) and Solverr mark under a payment page: two centered lines when narrow, one line when wide. */
export function CheckoutFooter({ invoiceId, embedded }: { invoiceId?: string; embedded: boolean }) {
  const m = en.checkout;
  return (
    <footer className="flex flex-col items-center gap-1 text-center text-meta text-muted @xl:flex-row @xl:flex-wrap @xl:justify-between @xl:gap-x-3">
      <a {...helpLinkProps(invoiceId, embedded)} className="inline-flex items-center py-1 whitespace-nowrap pointer-coarse:min-h-11 hover:text-fg hover:underline">
        {m.problemLink}
      </a>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <LogoMark className="size-4" /> {m.poweredBy}
      </span>
    </footer>
  );
}
