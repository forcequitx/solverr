"use client";

import * as m from "motion/react-m";
import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { formatCurrencyAmount, formatUtcDate } from "@/lib/format";
import type { SubscriptionRow } from "@/lib/merchants/subscription-stats";

/** "Cancel" with a confirm step, hidden for canceled subscriptions; it stays while `canceling` so a failure shows "Try again" and `error`. */
function CancelControl({ row, canceling, onCancel, error }: { row: SubscriptionRow; canceling: boolean; onCancel: () => void; error: string | null }) {
  if (row.status !== "active" && !canceling) return null;
  return <ConfirmAction label="Cancel" confirmLabel="Cancel it" ariaLabel={`Cancel the subscription for ${row.email}`} onConfirm={onCancel} pending={canceling} error={error} />;
}

type RowProps = { row: SubscriptionRow; index: number; delay: number; canceling?: boolean; onCancel?: () => void; cancelError?: string | null };

function StatusBadge({ row }: { row: SubscriptionRow }) {
  if (row.status === "canceled") return <Badge tone="muted">Canceled</Badge>;
  return row.due ? <Badge tone="info">Invoicing now</Badge> : <Badge tone="success">Active</Badge>;
}

const nextText = (row: SubscriptionRow) => (row.status === "active" ? formatUtcDate(row.next) : "—");
const everyText = (row: SubscriptionRow) => (row.interval === "week" ? "Every week" : "Every month");

/** Table row for a wide card; without `onCancel` it has no Actions cell. */
export function SubscriptionTableRow({ row, index, delay, canceling = false, onCancel, cancelError = null }: RowProps) {
  return (
    <m.tr {...listItemMotion(delay)} className="transition-colors hover:bg-surface-2/60">
      <td>
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar text={row.email} index={index} size="sm" />
          <div className="min-w-0">
            <p className="max-w-[240px] truncate font-medium" title={row.email}>
              {row.email}
            </p>
            <p className="max-w-[240px] truncate text-meta text-muted">{row.description ?? everyText(row)}</p>
          </div>
        </div>
      </td>
      <td>
        <span className="whitespace-nowrap rounded-md bg-surface-2 px-2 py-0.5 text-meta font-medium tabular-nums">{formatCurrencyAmount(row.amount, row.currency)}</span>
      </td>
      <td className="whitespace-nowrap text-meta">{everyText(row)}</td>
      <td className="whitespace-nowrap text-meta tabular-nums">
        {row.paid} of {row.invoices} paid
      </td>
      <td className="whitespace-nowrap text-meta text-muted">{nextText(row)}</td>
      <td>
        <StatusBadge row={row} />
      </td>
      {onCancel ? (
        <td>
          <CancelControl row={row} canceling={canceling} onCancel={onCancel} error={cancelError} />
        </td>
      ) : null}
    </m.tr>
  );
}

/** Stacked item for a narrow card; without `onCancel` it has no Cancel control. */
export function SubscriptionItem({ row, index, delay, canceling = false, onCancel, cancelError = null }: RowProps) {
  return (
    <m.li {...listItemMotion(delay)} className="flex flex-col gap-2 border-b border-line px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <InitialsAvatar text={row.email} index={index} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex items-center justify-between gap-2">
            <span className="truncate text-body font-medium">{row.email}</span>
            <span className="shrink-0 text-body font-semibold tabular-nums">{formatCurrencyAmount(row.amount, row.currency)}</span>
          </p>
          <p className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-meta text-muted">
              {everyText(row)} · {row.paid} of {row.invoices} paid · next {nextText(row)}
            </span>
            <StatusBadge row={row} />
          </p>
        </div>
      </div>
      {onCancel ? <CancelControl row={row} canceling={canceling} onCancel={onCancel} error={cancelError} /> : null}
    </m.li>
  );
}
