"use client";

import * as m from "motion/react-m";
import { CopyIconButton } from "@/components/dashboard/copy-buttons";
import { LinkQr } from "@/components/dashboard/links/link-qr";
import { ActionError } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/icon-box";
import { listItemMotion } from "@/components/ui/motion";
import { Switch } from "@/components/ui/switch";
import { formatCurrencyAmount, formatShortAmount, share } from "@/lib/format";
import type { LinkUsage } from "@/lib/merchants/link-stats";

export type LinkRow = { id: string; title: string; amount: string | null; currency: string; active: boolean; url: string } & LinkUsage;

/** One payment link: price, paid share, switch (`editable`), copy and QR; on phones the title gets the full first line and the controls sit
    beside the paid share. `toggleError` is why the last switch change failed. */
export function LinkItem({
  link,
  index,
  delay,
  editable,
  onToggle,
  toggleError = null,
}: {
  link: LinkRow;
  index: number;
  delay: number;
  editable: boolean;
  onToggle: () => void;
  toggleError?: string | null;
}) {
  const paidShare = share(link.paid, link.checkouts);
  return (
    <m.li
      {...listItemMotion(delay)}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-b border-line px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:gap-x-6 sm:px-6"
    >
      <div className={`col-span-2 flex min-w-0 items-center gap-3 transition-opacity motion-reduce:transition-none sm:col-span-1 ${link.active ? "" : "opacity-60"}`}>
        <InitialsAvatar text={link.title} index={index} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body font-semibold" title={link.title}>
              {link.title}
            </span>
            {link.active ? null : <Badge tone="muted">Off</Badge>}
          </p>
          <p className="truncate text-meta text-muted">
            <span className="font-medium text-fg">{link.amount ? formatCurrencyAmount(link.amount, link.currency) : `Customer chooses · ${link.currency}`}</span> · {link.url.replace(/^https?:\/\//, "")}
          </p>
        </div>
      </div>

      <div className="order-last flex items-center gap-1 justify-self-end">
        {editable ? <Switch checked={link.active} onChange={onToggle} label={`${link.title} takes payments`} title={link.active ? "Turn off" : "Turn on"} /> : null}
        <span className={`flex items-center ${editable ? "ml-2" : ""}`}>
          <CopyIconButton text={link.url} ariaLabel={`Copy link for ${link.title}`} />
          <LinkQr url={link.url} title={link.title} />
        </span>
      </div>

      <div className={`flex min-w-0 flex-col gap-1.5 ${link.active ? "" : "opacity-60"}`}>
        <p className="flex flex-wrap items-center justify-between gap-x-2 text-meta text-muted">
          <span className="min-w-0">
            {link.checkouts} {link.checkouts === 1 ? "checkout" : "checkouts"} · {link.paid} paid
          </span>
          <span className="shrink-0 font-medium tabular-nums text-fg">
            {formatShortAmount(link.collected)} {link.currency}
          </span>
        </p>
        <div role="progressbar" aria-label={`${link.title}: ${paidShare}% of checkouts paid`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={paidShare} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={{ width: `${paidShare}%` }} />
        </div>
      </div>
      <ActionError message={toggleError} tone="danger" className="order-last col-span-2 sm:col-span-3" />
    </m.li>
  );
}
