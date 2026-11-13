"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { EMPTY_LIST_HEIGHT } from "@/components/dashboard/list/list-styles";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { formatCurrencyAmount, formatUtcDate } from "@/lib/format";
import type { SubscriptionRow } from "@/lib/merchants/subscription-stats";

/** The next invoices active subscriptions will create, soonest first. */
export function UpcomingInvoices({ rows }: { rows: SubscriptionRow[] }) {
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <CardHeading icon="inbox" title="Next invoices" description="Solverr creates each invoice within a few minutes of its date. Dates are in UTC." />
      {rows.length === 0 ? (
        <p className={`grid flex-1 place-items-center rounded-[16px] border border-dashed border-line px-6 text-center text-meta text-muted ${EMPTY_LIST_HEIGHT}`}>Active subscriptions show their next invoice here.</p>
      ) : (
        <ul className="flex flex-1 flex-col">
          <AnimatePresence initial={false}>
            {rows.map((row, index) => (
              <m.li key={row.id} {...listItemMotion(index)} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
                <InitialsAvatar text={row.email} index={index} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{row.email}</p>
                  <p className="truncate text-meta text-muted">{formatCurrencyAmount(row.amount, row.currency)}</p>
                </div>
                {row.due ? <Badge tone="info">Invoicing now</Badge> : <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums">{formatUtcDate(row.next)}</span>}
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}
