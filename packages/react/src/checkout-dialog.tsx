"use client";

import { checkoutUrl, showOverlay, type CheckoutInvoice, type CheckoutTarget } from "solverr-embed/core";
import { useEffect, useLayoutEffect, useRef } from "react";

export interface CheckoutDialogProps {
  origin: string;
  target: CheckoutTarget;
  onPaid?: (invoice: CheckoutInvoice) => void;
  onClose: () => void;
}

/** Full-screen checkout overlay, the same one the script button opens; render it only on the client.
    It renders nothing itself: mounting shows the overlay and unmounting removes it. */
export function CheckoutDialog({ origin, target, onPaid, onClose }: CheckoutDialogProps) {
  const handlersRef = useRef({ onPaid, onClose });

  useEffect(() => {
    handlersRef.current = { onPaid, onClose };
  });

  useLayoutEffect(
    () =>
      showOverlay({
        src: checkoutUrl(origin, target, "overlay").href,
        origin,
        onPaid: (invoice) => handlersRef.current.onPaid?.(invoice),
        onClose: () => handlersRef.current.onClose(),
      }),
    [origin, target],
  );

  return null;
}
