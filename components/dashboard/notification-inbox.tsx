"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { type InboxAlert, useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionError } from "@/components/ui/action-error";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";
import { POPOVER_MOTION } from "@/components/ui/motion";
import { Segmented } from "@/components/ui/segmented";
import { usePopoverDismiss } from "@/components/ui/use-popover-dismiss";
import { INVOICE_ID } from "@/lib/invoices/invoice-id";
import { markAlertsReadAction } from "@/lib/merchants/actions/account";

type Group = "payments" | "account";
type Tab = "all" | Group;
type Kind = { title: string; icon: IconName; tone: "lime" | "blue" | "red"; group: Group; action?: { label: string; href: string } };

const KINDS: Record<string, Kind> = {
  "invoice.extra_payment": { title: "Extra payment received", icon: "coins", tone: "lime", group: "payments" },
  "invoice.failed": { title: "A payment failed in the swap", icon: "alert", tone: "red", group: "payments", action: { label: "Open support", href: "/dashboard/support" } },
  payment: { title: "A payment failed in the swap", icon: "alert", tone: "red", group: "payments", action: { label: "Open support", href: "/dashboard/support" } },
  split_payouts: { title: "Split payouts", icon: "transfers", tone: "lime", group: "payments", action: { label: "Review payouts", href: "/dashboard/transfers" } },
  private_payments_refused: { title: "Private payments refused", icon: "alert", tone: "red", group: "payments", action: { label: "Open settings", href: "/dashboard/settings" } },
  transfer_failed: { title: "A transfer failed", icon: "transfers", tone: "red", group: "payments", action: { label: "Open refunds & payouts", href: "/dashboard/transfers" } },
  subscription_failed: { title: "A subscription could not be billed", icon: "alert", tone: "red", group: "payments", action: { label: "Open subscriptions", href: "/dashboard/subscriptions" } },
  support_case: { title: "New support case", icon: "lifebuoy", tone: "blue", group: "payments", action: { label: "Open support", href: "/dashboard/support" } },
  payout_wallet_changed: { title: "Payout wallet changed", icon: "wallet", tone: "blue", group: "account", action: { label: "Open settings", href: "/dashboard/settings" } },
  payout_network_changed: { title: "Payout network changed", icon: "wallet", tone: "blue", group: "account", action: { label: "Open settings", href: "/dashboard/settings" } },
  split_changed: { title: "Revenue split added", icon: "split", tone: "blue", group: "account", action: { label: "Open settings", href: "/dashboard/settings" } },
  sign_in_wallet_linked: { title: "Sign-in wallet added", icon: "signIn", tone: "blue", group: "account", action: { label: "Open settings", href: "/dashboard/settings#sign-in" } },
  access_changed: { title: "Access to your business changed", icon: "shield", tone: "blue", group: "account", action: { label: "Review", href: "/dashboard/developers" } },
  team_changed: { title: "Your team changed", icon: "shield", tone: "blue", group: "account", action: { label: "Review team", href: "/dashboard/settings#team" } },
  website_changed: { title: "Business website changed", icon: "store", tone: "blue", group: "account", action: { label: "Open settings", href: "/dashboard/settings#profile" } },
  webhook_failed: { title: "Webhook delivery failed", icon: "webhook", tone: "red", group: "account", action: { label: "Open developers", href: "/dashboard/developers" } },
};
const DEFAULT_KIND: Kind = { title: "Notice", icon: "bell", tone: "blue", group: "account" };
const INBOX_ACTION = `inline-flex items-center rounded-[8px] px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-11 ${FOCUS_RING}`;

const TONES = { lime: "bg-success-bg text-success", blue: "bg-accent/10 text-accent-text", red: "bg-danger-bg text-danger" };
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "payments", label: "Payments" },
  { id: "account", label: "Account" },
];

/** Short age such as "2m", "3h", "Mon" or "Mar 4". */
function age(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  const date = new Date(iso);
  if (minutes < 7 * 24 * 60) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Bell button with an unread count that opens the alerts inbox: a popover under the bell, a full-width sheet at the top on phones. */
export function NotificationInbox({ alerts }: { alerts: InboxAlert[] }) {
  const merchantId = useMerchantId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const markRead = useAction();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const unread = alerts.filter((alert) => !alert.read).length;
  const kindOf = (alert: InboxAlert) => KINDS[alert.kind] ?? DEFAULT_KIND;
  const count = (id: Tab) => (id === "all" ? alerts.length : alerts.filter((alert) => kindOf(alert).group === id).length);
  const shown = tab === "all" ? alerts : alerts.filter((alert) => kindOf(alert).group === tab);

  usePopoverDismiss(open, { root, trigger: button, panel }, () => setOpen(false));

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`relative grid size-9 place-items-center rounded-control pointer-coarse:size-11 border border-line bg-surface text-fg shadow-card transition-colors hover:bg-surface-2 ${FOCUS_RING}`}
      >
        <Icon name="bell" className="size-[18px]" />
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-xs leading-none font-semibold text-surface ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <m.div
            {...POPOVER_MOTION}
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label="Activity inbox"
            tabIndex={-1}
            className="absolute left-0 top-full z-40 mt-2 flex w-[min(380px,calc(100vw-3rem))] origin-top-left flex-col max-sm:fixed max-sm:inset-x-3 max-sm:top-3 max-sm:mt-0 max-sm:w-auto max-sm:origin-top gap-3 rounded-[18px] border border-line bg-surface p-3 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.25)] outline-none lg:left-auto lg:right-0 lg:origin-top-right"
          >
            <div className="flex items-start justify-between gap-3 px-1 pt-1">
              <div>
                <p className="text-lg font-semibold tracking-tight">Activity inbox</p>
                <p className="text-meta text-muted">{unread === 0 ? "You are all caught up" : `${unread} new`}</p>
              </div>
              <button
                type="button"
                disabled={unread === 0 || markRead.pending}
                onClick={() => markRead.run(() => markAlertsReadAction(merchantId))}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 disabled:opacity-50 ${FOCUS_RING} ${
                  markRead.failed ? "bg-danger-solid text-white" : "bg-accent/10 text-accent-text hover:bg-accent/15"
                }`}
              >
                {markRead.failed ? <Icon name="retry" className="size-3.5" /> : null}
                {markRead.failed ? "Try again" : "Mark all as read"}
              </button>
            </div>
            <ActionError message={markRead.error} className="px-1" />

            <Segmented
              role="radiogroup"
              label="Filter notifications"
              className="h-9 w-full [&>button]:px-1.5"
              value={tab}
              onChange={setTab}
              options={TABS.map((item) => ({
                value: item.id,
                label: (
                  <>
                    {item.label}
                    <span className="rounded-[5px] bg-line/70 px-1.5 text-xs text-muted">{count(item.id)}</span>
                  </>
                ),
              }))}
            />

            <ul key={tab} className="flex max-h-[min(420px,60vh)] min-h-48 flex-col gap-2 overflow-y-auto pr-0.5 [scrollbar-width:none]">
              {shown.length === 0 ? (
                <li className="px-2 py-8 text-center text-meta text-muted">Nothing here yet. Payment problems, payout wallet changes and failed webhooks show up here.</li>
              ) : (
                shown.map((alert) => {
                  const kind = kindOf(alert);
                  const invoiceId = alert.message.match(INVOICE_ID)?.[0];
                  return (
                    <li key={alert.id} className="flex animate-row-in gap-3 rounded-[14px] border border-line p-3">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${TONES[kind.tone]}`}>
                        <Icon name={kind.icon} className="size-[18px]" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-body font-semibold">{kind.title}</p>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                            {age(alert.createdAt)}
                            {alert.read ? null : (
                              <>
                                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                                <span className="sr-only">New</span>
                              </>
                            )}
                          </span>
                        </div>
                        <p className="break-words text-meta text-muted">{alert.message}</p>
                        {invoiceId || kind.action ? (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {invoiceId ? (
                              <Link
                                href={`/dashboard/payments/${invoiceId}`}
                                onClick={() => setOpen(false)}
                                className={`${INBOX_ACTION} bg-accent text-accent-ink hover:bg-accent-hover`}
                              >
                                Open payment
                              </Link>
                            ) : null}
                            {kind.action ? (
                              <Link
                                href={kind.action.href}
                                onClick={() => setOpen(false)}
                                className={`${INBOX_ACTION} ${invoiceId ?"border border-line bg-surface text-fg hover:bg-surface-2" : "bg-accent text-accent-ink hover:bg-accent-hover"}`}
                              >
                                {kind.action.label}
                              </Link>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
