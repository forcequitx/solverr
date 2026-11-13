import type { ReactNode } from "react";

/** Label and value rows inside a detail card, divided by lines. */
export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-line text-body">{children}</dl>;
}

/** One row: the label above the value on phones, side by side from 640px. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-meta text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 sm:justify-end sm:text-right">{children}</dd>
    </div>
  );
}
