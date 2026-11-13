"use client";

import { CheckoutError } from "@/components/checkout/checkout-error";

export default function PaymentLinkError({ error, retry }: { error: unknown; retry: () => void }) {
  return <CheckoutError error={error} retry={retry} />;
}
