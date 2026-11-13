"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState, type ReactNode } from "react";
import { CopyAction } from "@/components/dashboard/copy-buttons";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { pageHeight } from "@/components/dashboard/list/list-styles";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { PAGE_SIZE, usePages } from "@/components/dashboard/list/use-pages";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { EXPAND_MOTION, listItemMotion } from "@/components/ui/motion";
import { Segmented } from "@/components/ui/segmented";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { resolveSupportCaseAction } from "@/lib/merchants/actions/support";
import { caseKindLabel } from "@/lib/support/case-kinds";

export type SupportCaseRow = {
  id: string;
  kind: string;
  status: "open" | "resolved";
  invoiceId: string | null;
  createdAt: string;
  /** Report fields as label and value, such as ["tx hash", "0xabc…"]. */
  details: [string, string][];
  /** The report as plain text for NEAR Intents support. */
  reportText: string;
};

type Filter = "open" | "resolved" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];
const EMPTY_TEXT: Record<Filter, string> = { open: "No open cases.", resolved: "No resolved cases yet.", all: "No cases yet." };
/** Room for a full page of eight collapsed 71px rows when there are several pages, so switching the filter or paging keeps the card's height. */
const LIST_HEIGHT = "min-h-[568px]";

function ResolveButton({ caseId }: { caseId: string }) {
  const merchantId = useMerchantId();
  const { pending, done, error, failed, run } = useAction();
  return (
    <div className="flex flex-col items-start gap-2">
      <ActionButton size="sm" pending={pending} done={done} doneLabel="Resolved" failed={failed} onClick={() => run(() => resolveSupportCaseAction(merchantId, caseId))}>
        <Icon name="check" className="size-4" />
        Mark resolved
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}

function CaseDetails({ row, editable }: { row: SupportCaseRow; editable: boolean }) {
  return (
    <m.div {...EXPAND_MOTION} className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 pb-5 sm:pl-[72px] sm:pr-6">
        <p className="text-meta text-muted">
          Case <span className="font-mono">{row.id}</span> · opened {formatUtcDateTime(row.createdAt)}
        </p>
        <dl className="grid gap-x-4 gap-y-2 rounded-[14px] border border-line bg-surface-2 p-4 text-meta sm:grid-cols-[140px_minmax(0,1fr)]">
          {row.details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="capitalize text-muted">{label}</dt>
              <dd className="break-all font-mono">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <CopyAction text={row.reportText} variant="secondary" size="sm">
            <Icon name="copy" className="size-4" />
            Copy report
          </CopyAction>
          {row.invoiceId ? (
            <ButtonLink href={`/dashboard/payments/${row.invoiceId}`} variant="secondary" size="sm">
              <Icon name="eye" className="size-4" />
              Open payment
            </ButtonLink>
          ) : null}
          {row.status === "open" && editable ? <ResolveButton caseId={row.id} /> : null}
        </div>
      </div>
    </m.div>
  );
}

function CaseItem({
  row,
  index,
  delay,
  expanded,
  editable,
  onToggle,
}: {
  row: SupportCaseRow;
  index: number;
  delay: number;
  expanded: boolean;
  editable: boolean;
  onToggle: () => void;
}) {
  const detailsId = `case-${row.id}`;
  return (
    <m.li {...listItemMotion(delay)} className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
        className="flex min-h-[70px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none sm:px-6"
      >
        <InitialsAvatar icon={row.kind === "swap_failed" ? "alert" : "lifebuoy"} index={index} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body font-medium">{caseKindLabel(row.kind)}</span>
          <span className="truncate text-meta text-muted">
            {row.invoiceId ? `Payment ${row.invoiceId}` : "No matching payment"} · {formatUtcDate(row.createdAt)}
          </span>
        </span>
        <Badge tone={row.status === "open" ? "warn" : "success"}>{row.status === "open" ? "Open" : "Resolved"}</Badge>
        <Icon name="chevronDown" className={`size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div id={detailsId}>
        <AnimatePresence initial={false}>{expanded ? <CaseDetails key="details" row={row} editable={editable} /> : null}</AnimatePresence>
      </div>
    </m.li>
  );
}

/** The newest `limit` support cases with an Open / Resolved / All filter; a case opens in place to show its report and actions (Mark resolved needs `editable`). */
export function SupportCases({ cases, limit, empty, editable }: { cases: SupportCaseRow[]; limit: number; empty: ReactNode; editable: boolean }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = filter === "all" ? cases : cases.filter((row) => row.status === filter);
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, PAGE_SIZE);

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-semibold">Cases</h2>
          <ListCount count={filtered.length} one="case" many="cases" loaded={cases.length} limit={limit} />
        </div>
        {cases.length > 0 ? (
          <Segmented
            role="radiogroup"
            label="Case status"
            options={FILTERS}
            value={filter}
            onChange={filterBy(setFilter)}
          />
        ) : null}
      </div>

      {cases.length === 0 ? (
        <ListEmpty>{empty}</ListEmpty>
      ) : (
        <>
          <ul className={`flex flex-col border-y border-line ${pageHeight(cases.length, PAGE_SIZE, LIST_HEIGHT)}`}>
            <AnimatePresence initial={false}>
              {visible.map((row, index) => (
                <CaseItem
                  key={row.id}
                  row={row}
                  index={page * PAGE_SIZE + index}
                  delay={index}
                  expanded={expanded === row.id}
                  editable={editable}
                  onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                />
              ))}
            </AnimatePresence>
            {visible.length === 0 ? <NoMatches as="li">{EMPTY_TEXT[filter]}</NoMatches> : null}
          </ul>
          <Pager page={page} pages={pages} onChange={setPage} label="Support case pages" />
        </>
      )}
    </Card>
  );
}
