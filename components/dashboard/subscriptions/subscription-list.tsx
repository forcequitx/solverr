"use client";

import { AnimatePresence } from "motion/react";
import { useOptimistic, useState, useTransition } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { LIST_TBODY, pageHeight } from "@/components/dashboard/list/list-styles";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { SearchField } from "@/components/dashboard/list/search-field";
import { PAGE_SIZE, usePages } from "@/components/dashboard/list/use-pages";
import { CreateSubscriptionForm, type CustomerEmails } from "@/components/dashboard/subscriptions/create-subscription-form";
import { SubscriptionItem, SubscriptionTableRow } from "@/components/dashboard/subscriptions/subscription-row";
import { UpcomingInvoices } from "@/components/dashboard/subscriptions/upcoming-invoices";
import { callAction } from "@/components/dashboard/use-action";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { cancelSubscriptionAction } from "@/lib/merchants/actions/subscriptions";
import type { SubscriptionRow } from "@/lib/merchants/subscription-stats";

type Filter = "all" | "active" | "canceled";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "canceled", label: "Canceled" },
];
/** Room for a full page when there are several: table head plus eight 67px rows; eight stacked items of up to 108px in the narrow list. */
const TABLE_HEIGHT = "min-h-[574px]";
const LIST_HEIGHT = "min-h-[864px]";

/** New-subscription form, the next invoices, and the newest `limit` subscriptions with search, a status filter and cancel; the form and cancel need `editable`. */
export function SubscriptionList({
  rows,
  limit,
  upcoming,
  customerEmails,
  currencies,
  editable,
}: {
  rows: SubscriptionRow[];
  limit: number;
  upcoming: SubscriptionRow[];
  customerEmails: CustomerEmails;
  currencies: readonly string[];
  editable: boolean;
}) {
  const merchantId = useMerchantId();
  const [canceling, markCanceling] = useOptimistic<string[], string>([], (ids, id) => [...ids, id]);
  const [, startTransition] = useTransition();
  /** A failed cancel undoes itself; the reason stays in that subscription's Cancel control, which stays open while canceling. */
  const [cancelError, setCancelError] = useState<{ id: string; message: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  /** The filter reads the saved status, so a row being canceled stays in place under Active until the result, and a failure's reason stays in view. */
  const filtered = rows
    .filter((row) => (filter === "all" || row.status === filter) && (!query || [row.email, row.description, row.id].some((value) => value?.toLowerCase().includes(query))))
    .map((row): SubscriptionRow => (canceling.includes(row.id) ? { ...row, status: "canceled", due: false } : row));
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, PAGE_SIZE);

  const cancel = (row: SubscriptionRow) =>
    startTransition(async () => {
      setCancelError(null);
      markCanceling(row.id);
      const result = await callAction(() => cancelSubscriptionAction(merchantId, row.id));
      if (!result.ok) setCancelError({ id: row.id, message: result.error });
    });
  const cancelErrorFor = (row: SubscriptionRow) => (cancelError?.id === row.id ? cancelError.message : null);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {editable ? (
        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <CreateSubscriptionForm customerEmails={customerEmails} currencies={currencies} />
          <UpcomingInvoices rows={upcoming.filter((row) => !canceling.includes(row.id))} />
        </div>
      ) : (
        <UpcomingInvoices rows={upcoming} />
      )}

      <Card className="@container min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 p-5 sm:p-6 @2xl:flex-row @2xl:items-center @2xl:justify-between">
          <div className="shrink-0">
            <h2 className="text-base font-semibold">Subscriptions</h2>
            <ListCount count={filtered.length} one="subscription" many="subscriptions" loaded={rows.length} limit={limit} />
          </div>
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Segmented role="radiogroup" options={FILTERS} value={filter} onChange={filterBy(setFilter)} label="Show subscriptions" />
              <SearchField label="Search subscriptions" value={search} onChange={filterBy(setSearch)} />
            </div>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <ListEmpty>
            <EmptyState title="No subscriptions yet">
              {editable ? "Create one above; each period Solverr invoices the customer for you." : "Each period, a subscription invoices the customer automatically."}
            </EmptyState>
          </ListEmpty>
        ) : (
          <>
            {/** With several pages, both layouts keep room for a full page, so paging or filtering never changes the card's height. */}
            <div className={`hidden flex-col overflow-x-auto [scrollbar-width:none] @4xl:flex ${pageHeight(rows.length, PAGE_SIZE, TABLE_HEIGHT)}`}>
              <table className="w-full min-w-[860px] border-collapse text-body">
                <ListTableHead labels={["Customer", "Amount", "Every", "Invoices", "Next invoice", "Status"]} action={editable ? "Actions" : undefined} />
                <tbody className={LIST_TBODY}>
                  <AnimatePresence initial={false}>
                    {visible.map((row, index) => (
                      <SubscriptionTableRow
                        key={row.id}
                        row={row}
                        index={page * PAGE_SIZE + index}
                        delay={index}
                        canceling={canceling.includes(row.id)}
                        onCancel={editable ? () => cancel(row) : undefined}
                        cancelError={cancelErrorFor(row)}
                      />
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {visible.length === 0 ? <NoMatches>No subscriptions match this search or filter.</NoMatches> : null}
            </div>

            <ul className={`flex flex-col border-t border-line @4xl:hidden ${pageHeight(rows.length, PAGE_SIZE, LIST_HEIGHT)}`}>
              <AnimatePresence initial={false}>
                {visible.map((row, index) => (
                  <SubscriptionItem
                    key={row.id}
                    row={row}
                    index={page * PAGE_SIZE + index}
                    delay={index}
                    canceling={canceling.includes(row.id)}
                    onCancel={editable ? () => cancel(row) : undefined}
                    cancelError={cancelErrorFor(row)}
                  />
                ))}
              </AnimatePresence>
              {visible.length === 0 ? <NoMatches as="li">No subscriptions match this search or filter.</NoMatches> : null}
            </ul>

            <Pager label="Subscription pages" page={page} pages={pages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
