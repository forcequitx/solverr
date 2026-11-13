/** Link props for the help page, naming the payment if any; help pages refuse to load in a frame, so the embedded checkout opens a new tab. */
export function helpLinkProps(invoiceId: string | undefined, embedded: boolean) {
  return {
    href: invoiceId ? `/help?invoice=${invoiceId}` : "/help",
    target: embedded ? "_blank" : undefined,
    rel: embedded ? "noreferrer" : undefined,
  };
}
