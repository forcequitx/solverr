import type { ReactNode } from "react";

export type BadgeTone = "success" | "accent" | "info" | "warn" | "danger" | "muted";

const TONES: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success",
  accent: "bg-accent/15 text-accent-tint-text",
  info: "bg-info-bg text-info",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  muted: "bg-surface-2 text-muted",
};

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Each invoice status's name and badge tone, in the order the dashboard's status filters list them. */
export const INVOICE_STATUSES: Record<string, [string, BadgeTone]> = {
  paid: ["Paid", "success"],
  created: ["Created", "muted"],
  awaiting_payment: ["Waiting for payment", "muted"],
  detected: ["Payment detected", "info"],
  processing: ["Converting", "info"],
  underpaid: ["Underpaid · refunding", "warn"],
  refunded: ["Refunded", "muted"],
  failed: ["Failed", "danger"],
  expired: ["Expired", "muted"],
};

/** An invoice status as a colored badge; `label` replaces the default status name, for example with the checkout's wording. */
export function InvoiceStatusBadge({ status, label }: { status: string; label?: string }) {
  const [name, tone] = INVOICE_STATUSES[status] ?? [status, "muted"];
  return <Badge tone={tone}>{label ?? name}</Badge>;
}
