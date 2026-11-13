"use client";

import * as m from "motion/react-m";
import Link from "next/link";
import { CopyIconButton } from "@/components/dashboard/copy-buttons";
import { ICON_ACTION } from "@/components/dashboard/list/list-styles";
import type { PaymentListRow } from "@/components/dashboard/payments/list-row";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { formatAmount, formatShortAmount, formatUtcDate } from "@/lib/format";

/** What the payment is for: its description (a payment link's title), else the merchant's order id, else the invoice id. */
const paymentLabel = (row: PaymentListRow) => row.description ?? (row.orderId ? `Order ${row.orderId}` : row.id);
const amountText = (row: PaymentListRow, format = formatAmount) => `${row.currency === "USD" ? "$" : ""}${format(row.amount)} ${row.currency}`;

function CopyCheckoutLink({ id }: { id: string }) {
  return <CopyIconButton text={`/pay/${id}`} path ariaLabel="Copy checkout link" />;
}

/** Phone layout: one stacked item per payment that opens its page, with a copy-link button; amounts from 100,000 up are shortened (1.23M). */
export function PaymentItem({ row, index, delay }: { row: PaymentListRow; index: number; delay: number }) {
  const label = paymentLabel(row);
  return (
    <m.li {...listItemMotion(delay)} className="flex items-center gap-2 border-b border-line pr-3">
      <Link href={`/dashboard/payments/${row.id}`} className={`flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 ${FOCUS_RING}`}>
        <InitialsAvatar text={label} index={index} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-body font-medium">{label}</span>
            <span className="shrink-0 text-body font-semibold tabular-nums">{amountText(row, formatShortAmount)}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-meta text-muted">
              {row.paidWith ?? "No coin paid"} · {formatUtcDate(row.createdAt)}
            </span>
            <InvoiceStatusBadge status={row.status} />
          </span>
        </span>
      </Link>
      <CopyCheckoutLink id={row.id} />
    </m.li>
  );
}

/** Desktop table row for one payment; its label opens the payment's dashboard page, and the copy button copies its checkout link. */
export function PaymentTableRow({ row, index, delay }: { row: PaymentListRow; index: number; delay: number }) {
  const label = paymentLabel(row);
  return (
    <m.tr {...listItemMotion(delay)} className="transition-colors hover:bg-surface-2/60">
      <td>
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar text={label} index={index} size="sm" />
          <Link href={`/dashboard/payments/${row.id}`} className={`max-w-[180px] truncate rounded-sm font-medium hover:underline ${FOCUS_RING}`} title={label}>
            {label}
          </Link>
          {row.agent ? <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent-tint-text">Agent</span> : null}
        </div>
      </td>
      <td>
        <InvoiceStatusBadge status={row.status} />
      </td>
      <td className="min-w-[120px] text-meta">{row.paidWith ?? <span className="text-muted">—</span>}</td>
      <td className="whitespace-nowrap text-meta text-muted">{formatUtcDate(row.createdAt)}</td>
      <td>
        <span className="whitespace-nowrap rounded-md bg-surface-2 px-2 py-0.5 text-meta font-medium tabular-nums">{amountText(row)}</span>
      </td>
      <td>
        <div className="flex justify-end gap-1">
          <Link href={`/dashboard/payments/${row.id}`} aria-label="Open payment" title="Open payment" className={ICON_ACTION}>
            <Icon name="eye" className="size-4" />
          </Link>
          <CopyCheckoutLink id={row.id} />
        </div>
      </td>
    </m.tr>
  );
}
