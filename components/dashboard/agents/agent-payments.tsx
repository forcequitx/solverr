"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { ICON_ACTION, LIST_TBODY, pageHeight } from "@/components/dashboard/list/list-styles";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { SearchField } from "@/components/dashboard/list/search-field";
import { PAGE_SIZE, usePages } from "@/components/dashboard/list/use-pages";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { listItemMotion } from "@/components/ui/motion";
import { formatCurrencyAmount, formatUtcDate } from "@/lib/format";
import type { AgentPayment } from "@/lib/merchants/agent-stats";

/** Room for a full page when there are several: table head plus eight 57px rows; eight 73px items in the narrow list. */
const TABLE_HEIGHT = "min-h-[494px]";
const LIST_HEIGHT = "min-h-[584px]";

/** The newest `limit` invoices created by the paywall, with search by route or ID; each opens its dashboard payment page. */
export function AgentPayments({ payments, limit }: { payments: AgentPayment[]; limit: number }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = payments.filter((payment) => !query || [payment.resource, payment.id].some((value) => value.toLowerCase().includes(query)));
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, PAGE_SIZE);

  return (
    <Card className="@container min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 p-5 sm:p-6 @xl:flex-row @xl:items-center @xl:justify-between">
        <div>
          <h2 className="text-base font-semibold">Agent payments</h2>
          <ListCount count={filtered.length} one="payment" many="payments" loaded={payments.length} limit={limit} />
        </div>
        {payments.length > 0 ? (
          <SearchField label="Search routes" value={search} onChange={filterBy(setSearch)} />
        ) : null}
      </div>

      {payments.length === 0 ? (
        <ListEmpty>
          <EmptyState title="No agent payments yet">Each call an agent pays through your paywall appears here with the route it paid for.</EmptyState>
        </ListEmpty>
      ) : (
        <>
          <div className={`hidden flex-col overflow-x-auto [scrollbar-width:none] @3xl:flex ${pageHeight(payments.length, PAGE_SIZE, TABLE_HEIGHT)}`}>
            <table className="w-full min-w-[680px] border-collapse text-body">
              <ListTableHead labels={["Route", "Amount", "Status", "Created"]} action={<span className="sr-only">Open</span>} />
              <tbody className={LIST_TBODY}>
                <AnimatePresence initial={false}>
                  {visible.map((payment, index) => (
                    <m.tr key={payment.id} {...listItemMotion(index)} className="transition-colors hover:bg-surface-2/60">
                      <td>
                        <span className="block max-w-[320px] truncate font-mono text-meta" title={payment.resource}>
                          {payment.resource}
                        </span>
                      </td>
                      <td>
                        <span className="whitespace-nowrap rounded-md bg-surface-2 px-2 py-0.5 text-meta font-medium tabular-nums">{formatCurrencyAmount(payment.amount, payment.currency)}</span>
                      </td>
                      <td>
                        <InvoiceStatusBadge status={payment.status} />
                      </td>
                      <td className="whitespace-nowrap text-meta text-muted">{formatUtcDate(payment.createdAt)}</td>
                      <td>
                        <div className="flex justify-end">
                          <Link href={`/dashboard/payments/${payment.id}`} aria-label="Open payment" title="Open payment" className={ICON_ACTION}>
                            <Icon name="eye" className="size-4" />
                          </Link>
                        </div>
                      </td>
                    </m.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {visible.length === 0 ? <NoMatches>No agent payments match this search.</NoMatches> : null}
          </div>

          <ul className={`flex flex-col border-t border-line @3xl:hidden ${pageHeight(payments.length, PAGE_SIZE, LIST_HEIGHT)}`}>
            <AnimatePresence initial={false}>
              {visible.map((payment, index) => (
                <m.li key={payment.id} {...listItemMotion(index)} className="border-b border-line">
                  <Link href={`/dashboard/payments/${payment.id}`} className={`flex min-w-0 flex-col gap-1 px-5 py-3 ${FOCUS_RING}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-body">{payment.resource}</span>
                      <span className="shrink-0 text-body font-semibold tabular-nums">{formatCurrencyAmount(payment.amount, payment.currency)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-meta text-muted">{formatUtcDate(payment.createdAt)}</span>
                      <InvoiceStatusBadge status={payment.status} />
                    </span>
                  </Link>
                </m.li>
              ))}
            </AnimatePresence>
            {visible.length === 0 ? <NoMatches as="li">No agent payments match this search.</NoMatches> : null}
          </ul>

          <Pager label="Agent payment pages" page={page} pages={pages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
