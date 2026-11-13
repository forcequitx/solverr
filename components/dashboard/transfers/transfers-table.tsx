"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useState } from "react";
import type { TransferKind } from "@/generated/prisma/client";
import { MiddleEllipsis } from "@/components/dashboard/detail/middle-ellipsis";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FilterSelect } from "@/components/dashboard/list/filter-select";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { ICON_ACTION, LIST_TBODY, pageHeight } from "@/components/dashboard/list/list-styles";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { SearchField } from "@/components/dashboard/list/search-field";
import { usePages } from "@/components/dashboard/list/use-pages";
import { STATUS_LABELS, TransferStatusBadge } from "@/components/dashboard/transfers/transfer-status";
import { Card } from "@/components/ui/card";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";
import { TINTS } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { Segmented } from "@/components/ui/segmented";
import { formatUtcDate } from "@/lib/format";
import type { TransferRow } from "@/lib/merchants/transfer-stats";
import { KIND_LABELS } from "@/lib/transfers/kinds";

const PAGE_SIZE = 10;
/** Room for a full page when there are several: table head plus ten 65px rows; ten 73px items in the narrow list. */
const TABLE_HEIGHT = "min-h-[688px]";
const LIST_HEIGHT = "min-h-[730px]";
const KIND_OPTIONS: { value: TransferKind | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "refund", label: "Refunds" },
  { value: "payout", label: "Payouts" },
  { value: "withdrawal", label: "Earn" },
];
const STATUS_OPTIONS: [string, string][] = [["", "All statuses"], ...Object.entries(STATUS_LABELS)];
const KIND_ICONS: Record<TransferKind, { icon: IconName; tint: string }> = {
  refund: { icon: "arrowLeft", tint: TINTS.blue },
  payout: { icon: "arrowUpRight", tint: TINTS.lime },
  withdrawal: { icon: "coins", tint: TINTS.lime },
};
const APPROVE = `inline-flex h-8 shrink-0 items-center rounded-control bg-accent px-3 text-sm font-semibold pointer-coarse:h-11 text-accent-ink transition-colors hover:bg-accent-hover motion-reduce:transition-none ${FOCUS_RING}`;

const amountText = (row: TransferRow) => `${row.amount} ${row.symbol}`.trim();

function KindIcon({ kind }: { kind: TransferKind }) {
  const { icon, tint } = KIND_ICONS[kind];
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-full ${tint}`}>
      <Icon name={icon} className="size-4" />
    </span>
  );
}

/** A pending transfer offers Approve to those who can send it; viewers, and a split payout on hold, get the same Open action as any other transfer. */
function RowAction({ row, editable }: { row: TransferRow; editable: boolean }) {
  return row.status === "pending" && editable && !row.onHold ? (
    <Link href={`/dashboard/transfers/${row.id}`} className={APPROVE}>
      Approve
    </Link>
  ) : (
    <Link href={`/dashboard/transfers/${row.id}`} aria-label={`Open ${KIND_LABELS[row.kind].toLowerCase()}`} title="Open" className={ICON_ACTION}>
      <Icon name="eye" className="size-4" />
    </Link>
  );
}

/** Phone layout: one stacked item per transfer that opens its page. */
function TransferItem({ row, delay }: { row: TransferRow; delay: number }) {
  return (
    <m.li {...listItemMotion(delay)} className="border-b border-line">
      <Link href={`/dashboard/transfers/${row.id}`} className={`flex min-w-0 items-center gap-3 py-3 pl-5 pr-4 ${FOCUS_RING}`}>
        <KindIcon kind={row.kind} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-body font-medium">{KIND_LABELS[row.kind]}</span>
            <span className="shrink-0 text-body font-semibold tabular-nums">{amountText(row)}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <MiddleEllipsis value={row.recipient} className="font-mono text-meta text-muted" />
            <TransferStatusBadge status={row.status} />
          </span>
        </span>
      </Link>
    </m.li>
  );
}

function TransferTableRow({ row, delay, editable }: { row: TransferRow; delay: number; editable: boolean }) {
  return (
    <m.tr {...listItemMotion(delay)} className="transition-colors hover:bg-surface-2/60">
      <td>
        <div className="flex items-center gap-3">
          <KindIcon kind={row.kind} />
          <span className="whitespace-nowrap font-medium">{KIND_LABELS[row.kind]}</span>
        </div>
      </td>
      <td>
        <span className="whitespace-nowrap rounded-md bg-surface-2 px-2 py-0.5 text-meta font-medium tabular-nums">{amountText(row)}</span>
      </td>
      <td className="max-w-[240px]">
        <MiddleEllipsis value={row.recipient} className="font-mono text-meta" />
        <span className="block truncate text-meta text-muted">Gets {row.destination}</span>
      </td>
      <td>
        <TransferStatusBadge status={row.status} />
      </td>
      <td className="whitespace-nowrap text-meta text-muted">{formatUtcDate(row.createdAt)}</td>
      <td>
        <div className="flex justify-end">
          <RowAction row={row} editable={editable} />
        </div>
      </td>
    </m.tr>
  );
}

/** Refunds, payouts and Earn withdrawals with a type switch, a status filter, search as you type, and pages of ten. */
export function TransfersTable({ rows, limit, editable }: { rows: TransferRow[]; limit: number; editable: boolean }) {
  const [kind, setKind] = useState<TransferKind | "">("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filtered = rows.filter((row) => (!kind || row.kind === kind) && (!status || row.status === status) && (!query || [row.id, row.recipient].some((value) => value.toLowerCase().includes(query))));
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, PAGE_SIZE);

  return (
    <Card className="@container min-w-0">
      <div className="flex flex-col gap-3 p-5 sm:p-6 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div className="shrink-0">
          <h2 className="text-base font-semibold">Refunds & payouts</h2>
          <ListCount count={filtered.length} one="transfer" many="transfers" loaded={rows.length} limit={limit} />
        </div>
        {rows.length > 0 ? (
          <div className="flex flex-wrap items-start gap-2">
            <Segmented role="radiogroup" options={KIND_OPTIONS} value={kind} onChange={filterBy(setKind)} label="Transfer type" className="w-full @md:w-auto [&>button]:px-1.5 @md:[&>button]:px-2.5" />
            <FilterSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={filterBy(setStatus)} />
            <SearchField label="Search recipient or ID" value={search} onChange={filterBy(setSearch)} />
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <ListEmpty>
          <EmptyState title="No refunds or payouts yet">
            {editable ? "Refund a paid payment from its page, or create payouts above." : "Refunds and payouts your team sends appear here."}
          </EmptyState>
        </ListEmpty>
      ) : (
        <>
          {/** With several pages, both layouts keep room for a full page, so paging or filtering never changes the card's height. */}
          <div className={`hidden flex-col overflow-x-auto [scrollbar-width:none] @3xl:flex ${pageHeight(rows.length, PAGE_SIZE, TABLE_HEIGHT)}`}>
            <table className="w-full min-w-[760px] border-collapse text-body">
              <ListTableHead labels={["Type", "Amount", "Recipient", "Status", "Created"]} action="Action" />
              <tbody className={LIST_TBODY}>
                <AnimatePresence initial={false}>
                  {visible.map((row, index) => (
                    <TransferTableRow key={row.id} row={row} delay={index} editable={editable} />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {visible.length === 0 ? <NoMatches>No transfers match these filters.</NoMatches> : null}
          </div>

          <ul className={`flex flex-col border-t border-line @3xl:hidden ${pageHeight(rows.length, PAGE_SIZE, LIST_HEIGHT)}`}>
            <AnimatePresence initial={false}>
              {visible.map((row, index) => (
                <TransferItem key={row.id} row={row} delay={index} />
              ))}
            </AnimatePresence>
            {visible.length === 0 ? <NoMatches as="li">No transfers match these filters.</NoMatches> : null}
          </ul>

          <Pager page={page} pages={pages} onChange={setPage} label="Transfers pages" />
        </>
      )}
    </Card>
  );
}
