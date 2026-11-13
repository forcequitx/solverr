"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState, type ReactNode } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { DeliveryStatusBadge, type DeliveryStatus } from "@/components/dashboard/developers/delivery-status";
import { FilterSelect } from "@/components/dashboard/list/filter-select";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { LIST_TBODY, pageHeight } from "@/components/dashboard/list/list-styles";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { PAGE_SIZE, usePages } from "@/components/dashboard/list/use-pages";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Card } from "@/components/ui/card";
import { listItemMotion } from "@/components/ui/motion";
import { Segmented } from "@/components/ui/segmented";
import { formatUtcDateTime } from "@/lib/format";
import { resendDeliveryAction } from "@/lib/merchants/actions/developers";

type DeliveryRow = { id: string; eventType: string; status: DeliveryStatus; attempts: number; response: string; createdAt: string };

type Filter = "all" | "delivered" | "failed" | "pending";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];
/** Room for a full page when there are several: table head plus eight 61px rows; eight items of up to 93px in the narrow list. */
const TABLE_HEIGHT = "min-h-[530px]";
const LIST_HEIGHT = "min-h-[744px]";

function ResendButton({ delivery }: { delivery: DeliveryRow }) {
  const merchantId = useMerchantId();
  const { pending, done, error, failed, run } = useAction();
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <ActionButton
        variant="secondary"
        size="sm"
        pending={pending}
        done={done}
        doneLabel="Delivered"
        failed={failed}
        aria-label={`Resend ${delivery.eventType}`}
        onClick={() => run(() => resendDeliveryAction(merchantId, delivery.id))}
      >
        Resend
      </ActionButton>
      <ActionError message={error} className="max-w-64 text-right" />
    </div>
  );
}

function DeliveryItem({ delivery, delay, canResend }: { delivery: DeliveryRow; delay: number; canResend: boolean }) {
  return (
    <m.li {...listItemMotion(delay)} className="flex min-h-[77px] flex-col justify-center gap-1 border-b border-line px-5 py-3">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-meta font-medium">{delivery.eventType}</span>
        <DeliveryStatusBadge status={delivery.status} />
      </span>
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-meta text-muted">
          {delivery.response} · {delivery.attempts} {delivery.attempts === 1 ? "attempt" : "attempts"} · {formatUtcDateTime(delivery.createdAt)}
        </span>
        {canResend ? <ResendButton delivery={delivery} /> : null}
      </span>
    </m.li>
  );
}

function DeliveryTableRow({ delivery, delay, canResend }: { delivery: DeliveryRow; delay: number; canResend: boolean }) {
  return (
    <m.tr {...listItemMotion(delay)} className="transition-colors hover:bg-surface-2/60">
      <td className="font-mono text-meta font-medium">{delivery.eventType}</td>
      <td>
        <DeliveryStatusBadge status={delivery.status} />
      </td>
      <td className="tabular-nums">{delivery.attempts}</td>
      <td className="max-w-56 truncate font-mono text-meta" title={delivery.response}>
        {delivery.response}
      </td>
      <td className="whitespace-nowrap text-meta text-muted">{formatUtcDateTime(delivery.createdAt)}</td>
      {canResend ? (
        <td className="text-right">
          <ResendButton delivery={delivery} />
        </td>
      ) : null}
    </m.tr>
  );
}

/** The newest `limit` webhook deliveries with a status filter and pages of eight; with `canResend` (an editor, webhooks on, a URL saved), each one can be sent again. */
export function DeliveryLog({ deliveries, limit, empty, canResend }: { deliveries: DeliveryRow[]; limit: number; empty: ReactNode; canResend: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = filter === "all" ? deliveries : deliveries.filter((delivery) => delivery.status === filter);
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, PAGE_SIZE);

  return (
    <Card className="@container min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-semibold">Delivery log</h2>
          <ListCount count={filtered.length} one="delivery" many="deliveries" loaded={deliveries.length} limit={limit} />
        </div>
        {deliveries.length > 0 ? (
          <>
            {/** Four options do not fit beside each other in a phone-width card, so a narrow card offers them as a menu. */}
            <div className="hidden @md:block">
              <Segmented role="radiogroup" label="Delivery status" options={FILTERS} value={filter} onChange={filterBy(setFilter)} />
            </div>
            <div className="@md:hidden">
              <FilterSelect label="Delivery status" value={filter} options={FILTERS.map((option) => [option.value, option.value === "all" ? "All deliveries" : option.label])} onChange={filterBy((value: string) => setFilter(value as Filter))} />
            </div>
          </>
        ) : null}
      </div>

      {deliveries.length === 0 ? (
        <ListEmpty>{empty}</ListEmpty>
      ) : (
        <>
          <div className={`hidden flex-col overflow-x-auto border-b border-line [scrollbar-width:none] @3xl:flex ${pageHeight(deliveries.length, PAGE_SIZE, TABLE_HEIGHT)}`}>
            <table className="w-full min-w-[760px] border-collapse text-body">
              <ListTableHead labels={["Event", "Status", "Attempts", "Response", "Created"]} action={canResend ? "Actions" : undefined} />
              <tbody className={LIST_TBODY}>
                <AnimatePresence initial={false}>
                  {visible.map((delivery, index) => (
                    <DeliveryTableRow key={delivery.id} delivery={delivery} delay={index} canResend={canResend} />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {visible.length === 0 ? <NoMatches>No deliveries have this status.</NoMatches> : null}
          </div>

          <ul className={`flex flex-col border-y border-line @3xl:hidden ${pageHeight(deliveries.length, PAGE_SIZE, LIST_HEIGHT)}`}>
            <AnimatePresence initial={false}>
              {visible.map((delivery, index) => (
                <DeliveryItem key={delivery.id} delivery={delivery} delay={index} canResend={canResend} />
              ))}
            </AnimatePresence>
            {visible.length === 0 ? <NoMatches as="li">No deliveries have this status.</NoMatches> : null}
          </ul>

          <Pager page={page} pages={pages} onChange={setPage} label="Delivery log pages" />
        </>
      )}
    </Card>
  );
}
