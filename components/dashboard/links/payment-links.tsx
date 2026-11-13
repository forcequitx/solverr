"use client";

import { AnimatePresence } from "motion/react";
import { useOptimistic, useState, useTransition } from "react";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CreateLinkForm } from "@/components/dashboard/links/create-link-form";
import { LinkItem, type LinkRow } from "@/components/dashboard/links/link-row";
import { ListCount } from "@/components/dashboard/list/list-count";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { pageHeight } from "@/components/dashboard/list/list-styles";
import { NoMatches } from "@/components/dashboard/list/no-matches";
import { Pager } from "@/components/dashboard/list/pager";
import { SearchField } from "@/components/dashboard/list/search-field";
import { usePages } from "@/components/dashboard/list/use-pages";
import { callAction } from "@/components/dashboard/use-action";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { toggleLinkAction } from "@/lib/merchants/actions/links";

type Filter = "all" | "active" | "off";

const PAGE_SIZE = 6;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "off", label: "Off" },
];
/** Room for a full page when there are several: six 85px rows from 640px up, six 137px stacked items on phones. */
const LIST_HEIGHT = "min-h-[822px] sm:min-h-[510px]";

/** New-link form and the merchant's newest `limit` links with search, an active/off filter and instant on/off switches; the form and switches need `editable`. */
export function PaymentLinks({ links, limit, currencies, editable }: { links: LinkRow[]; limit: number; currencies: readonly string[]; editable: boolean }) {
  const merchantId = useMerchantId();
  const [shown, setActive] = useOptimistic(links, (state, change: { id: string; active: boolean }) => state.map((link) => (link.id === change.id ? { ...link, active: change.active } : link)));
  const [, startTransition] = useTransition();
  /** The switch flips back by itself when a change fails; this keeps the reason next to it. */
  const [toggleError, setToggleError] = useState<{ id: string; message: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filtered = shown.filter(
    (link) => (filter === "all" || link.active === (filter === "active")) && (!query || [link.title, link.url, link.id].some((value) => value.toLowerCase().includes(query))),
  );
  const { page, pages, visible, setPage, filterBy } = usePages(filtered, PAGE_SIZE);

  const toggle = (link: LinkRow) =>
    startTransition(async () => {
      const active = !link.active;
      setToggleError(null);
      setActive({ id: link.id, active });
      const result = await callAction(() => toggleLinkAction(merchantId, link.id, active));
      if (!result.ok) setToggleError({ id: link.id, message: result.error });
    });

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {editable ? <CreateLinkForm currencies={currencies} /> : null}

      <Card className="min-w-0">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Your links</h2>
            <ListCount count={filtered.length} one="link" many="links" loaded={links.length} limit={limit} />
          </div>
          {links.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                role="radiogroup"
                options={FILTERS}
                value={filter}
                onChange={filterBy(setFilter)}
                label="Show links"
              />
              <SearchField label="Search links" value={search} onChange={filterBy(setSearch)} />
            </div>
          ) : null}
        </div>

        {links.length === 0 ? (
          <ListEmpty>
            <EmptyState title="No payment links yet">A link works anywhere: a message, a social post, an invoice PDF or a QR code on the counter.</EmptyState>
          </ListEmpty>
        ) : (
          <>
            <ul className={`flex flex-col border-t border-line ${pageHeight(links.length, PAGE_SIZE, LIST_HEIGHT)}`}>
              <AnimatePresence initial={false}>
                {visible.map((link, index) => (
                  <LinkItem
                    key={link.id}
                    link={link}
                    index={page * PAGE_SIZE + index}
                    delay={index}
                    editable={editable}
                    onToggle={() => toggle(link)}
                    toggleError={toggleError?.id === link.id ? toggleError.message : null}
                  />
                ))}
              </AnimatePresence>
              {visible.length === 0 ? <NoMatches as="li">No links match this search or filter.</NoMatches> : null}
            </ul>
            <Pager label="Payment link pages" page={page} pages={pages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
