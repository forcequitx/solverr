"use client";

import { appOrigin, checkoutUrl, type CheckoutInvoice, type CheckoutMode, type CheckoutTarget } from "solverr-embed/core";
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { CheckoutDialog } from "./checkout-dialog.js";
import { useProvidedBaseUrl } from "./provider.js";
import { PAY_BUTTON_CLASS, PAY_BUTTON_STYLE, useSolverrStyles } from "./styles.js";

export type PayButtonProps = CheckoutTarget & {
  /** Origin of the Solverr app; defaults to the nearest SolverrProvider. */
  baseUrl?: string;
  /** "page" (default) goes to the full checkout page; "overlay" opens it in a popup over this page. */
  mode?: CheckoutMode;
  /** Overlay only: called when the checkout reports payment. The order is fulfilled only after the server confirms the payment. */
  onPaid?: (invoice: CheckoutInvoice) => void;
  /** Overlay only: called when the popup closes. */
  onClose?: () => void;
  /** Replaces the default button styles. */
  className?: string;
  children?: ReactNode;
};

type Checkout =
  | { origin: string; target: CheckoutTarget; href: string; error?: never }
  | { error: Error; origin?: never; target?: never; href?: never };

/** Validates the setup and builds the full checkout page URL; the overlay URL is built in the browser when it opens. */
function resolveCheckout(baseUrl: string | undefined, target: CheckoutTarget): Checkout {
  try {
    if (!baseUrl) throw new Error("PayButton needs a baseUrl prop or a <SolverrProvider baseUrl> above it.");
    const origin = appOrigin(baseUrl);
    return { origin, target, href: checkoutUrl(origin, target, "page").href };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Pay button for a payment link or an invoice: a link to the full checkout page, or a popup with `mode="overlay"`.
    An invalid setup renders it disabled and logs why. */
export function PayButton({ link, invoice, baseUrl, mode = "page", onPaid, onClose, className, children }: PayButtonProps): ReactElement {
  const providedBaseUrl = useProvidedBaseUrl();
  const resolvedBaseUrl = baseUrl ?? providedBaseUrl;
  const checkout = useMemo(
    () => resolveCheckout(resolvedBaseUrl, link !== undefined ? { link } : { invoice: invoice ?? "" }),
    [resolvedBaseUrl, link, invoice],
  );
  const [open, setOpen] = useState(false);
  useSolverrStyles();

  useEffect(() => {
    if (checkout.error) console.error(`Solverr PayButton: ${checkout.error.message}`);
  }, [checkout.error]);

  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const look = { className: className ?? PAY_BUTTON_CLASS, style: className ? undefined : PAY_BUTTON_STYLE };
  const label = children ?? "Pay with crypto";

  if (mode === "page" && checkout.href !== undefined) {
    return (
      <a href={checkout.href} {...look}>
        {label}
      </a>
    );
  }
  return (
    <>
      <button type="button" {...look} aria-haspopup={mode === "overlay" ? "dialog" : undefined} disabled={checkout.error !== undefined} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && checkout.target !== undefined && <CheckoutDialog origin={checkout.origin} target={checkout.target} onPaid={onPaid} onClose={close} />}
    </>
  );
}
