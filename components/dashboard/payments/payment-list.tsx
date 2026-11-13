"use client";

import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FilterSelect } from "@/components/dashboard/list/filter-select";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { LIST_TBODY, pageHeight } from "@/components/dashboard/list/list-styles";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { SearchField } from "@/components/dashboard/list/search-field";
import { usePages } from "@/components/dashboard/list/use-pages";
import { matchesPaymentFilters, paymentChains, type PaymentListRow } from "@/components/dashboard/payments/list-row";
import { PaymentItem, PaymentTableRow } from "@/components/dashboard/payments/payment-rows";
import { INVOICE_STATUSES } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NetworkSelect } from "@/components/ui/network-select";

const STATUS_OPTIONS: [string, string][] = [["", "All statuses"], ...Object.entries(INVOICE_STATUSES).map(([status, [label]]): [string, string] => [status, label])];
/** Room for a full page when there are several: table head plus 57px rows; 73px items in the narrow list. */
const PAGE_HEIGHTS = {
  8: { table: "min-h-[492px]", list: "min-h-[584px]" },
  10: { table: "min-h-[606px]", list: "min-h-[730px]" },
} as const;

/** Payments with filters, search and pages; `limit` (newest rows loaded) shows in the count once reached; `exportable` adds a filtered CSV export. */
export function PaymentList({
  rows,
  title,
  pageSize,
  limit,
  exportable = false,
  initialStatus = "",
}: {
  rows: PaymentListRow[];
  title: string;
  pageSize: keyof typeof PAGE_HEIGHTS;
  limit?: number;
  exportable?: boolean;
  initialStatus?: string;
}) {
  const merchantId = useMerchantId();
  const [status, setStatus] = useState(initialStatus);
  const [chain, setChain] = useState("");
  const [search, setSearch] = useState("");

  const filtered = rows.filter((row) => matchesPaymentFilters(row, { status, chain, search }));
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, pageSize);
  const chains = paymentChains(rows);
  const heights = PAGE_HEIGHTS[pageSize];
  /** The export repeats the filters shown and names the business this tab shows, which the server checks against the selected one. */
  const exportQuery = new URLSearchParams(Object.entries({ merchant: merchantId, status, chain, search: search.trim() }).filter(([, value]) => value));

  return (
    <Card className="@container min-w-0">
      <div className="flex flex-col gap-3 p-5 sm:p-6 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div className="shrink-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <ListCount count={filtered.length} one="payment" many="payments" loaded={rows.length} limit={limit} />
        </div>
        {rows.length > 0 ? (
          <div className="flex flex-wrap items-start gap-2">
            <FilterSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={filterBy(setStatus)} />
            <NetworkSelect size="sm" label="Chain" value={chain} onChange={filterBy(setChain)} chains={chains} valueFor={(c) => c.name} allLabel="All chains" />
            <SearchField label="Search payments" value={search} onChange={filterBy(setSearch)} />
            {exportable ? (
              /** A plain `<a>`, not `ButtonLink`: next/link would prefetch the route handler and build the CSV in the background. */
              <a href={`/dashboard/payments/export?${exportQuery}`} title="Download the payments that match the filters as a CSV file." className={buttonClass("secondary", "sm")}>
                Export CSV
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <ListEmpty>
          <EmptyState title="No payments yet">Create a payment link or call the API; payments appear here as soon as a customer opens the checkout.</EmptyState>
        </ListEmpty>
      ) : (
        <>
          {/** With several pages, both layouts keep room for a full page, so paging or filtering never changes the card's height. */}
          <div className={`hidden flex-col overflow-x-auto [scrollbar-width:none] @4xl:flex ${pageHeight(rows.length, pageSize, heights.table)}`}>
            <table className="w-full min-w-[820px] border-collapse text-body">
              <ListTableHead labels={["Payment", "Status", "Paid with", "Created", "Amount"]} action="Actions" />
              <tbody className={LIST_TBODY}>
                <AnimatePresence initial={false}>
                  {visible.map((row, index) => (
                    <PaymentTableRow key={row.id} row={row} index={page * pageSize + index} delay={index} />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {visible.length === 0 ? <NoMatches>No payments match these filters.</NoMatches> : null}
          </div>

          <ul className={`flex flex-col border-t border-line @4xl:hidden ${pageHeight(rows.length, pageSize, heights.list)}`}>
            <AnimatePresence initial={false}>
              {visible.map((row, index) => (
                <PaymentItem key={row.id} row={row} index={page * pageSize + index} delay={index} />
              ))}
            </AnimatePresence>
            {visible.length === 0 ? <NoMatches as="li">No payments match these filters.</NoMatches> : null}
          </ul>

          <Pager page={page} pages={pages} onChange={setPage} label={`${title} pages`} />
        </>
      )}
    </Card>
  );
}
