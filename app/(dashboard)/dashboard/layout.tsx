import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { DashboardProvider } from "@/components/dashboard/dashboard-context";
import { MobileNav, Sidebar } from "@/components/dashboard/sidebar";
import { SIDEBAR_COOKIE } from "@/components/dashboard/sidebar-cookie";
import { getMemberships, requireMerchant } from "@/lib/auth/session";
import { inboxAlerts, OWNER_ONLY_ALERT_KINDS } from "@/lib/merchants/alerts";
import { logoUrl } from "@/lib/merchants/logo";
import { paymentsDelayed } from "@/lib/payments/health";

const INBOX_SIZE = 30;

/** Each page sets its own title (the sidebar label); pages without one, such as a payment's detail page, show the default. */
export const metadata: Metadata = { title: { template: "%s · Solverr", default: "Dashboard · Solverr" }, robots: { index: false } };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { merchant, user, role } = await requireMerchant();
  const [alerts, delayed, memberships, cookieStore] = await Promise.all([
    inboxAlerts(merchant.id, INBOX_SIZE),
    paymentsDelayed(),
    getMemberships(user.id),
    cookies(),
  ]);
  const businesses = memberships.map((membership) => ({ id: membership.merchantId, name: membership.merchant.name, logoUrl: logoUrl(membership.merchant.logoId), role: membership.role }));
  const teammateOnly = !memberships.some((membership) => membership.role === "owner");
  const sidebar = { businesses, currentId: merchant.id, businessName: merchant.name, userName: user.name };
  /** Only the owner can mark owner-only alerts read, so for teammates they show as read and never leave a badge they cannot clear. */
  const ownerOnlyForTeammate = (kind: string) => role !== "owner" && OWNER_ONLY_ALERT_KINDS.includes(kind);
  const inbox = alerts.map((alert) => ({
    id: alert.id,
    kind: alert.kind,
    message: alert.message,
    createdAt: alert.createdAt.toISOString(),
    read: alert.readAt !== null || ownerOnlyForTeammate(alert.kind),
  }));

  return (
    <DashboardProvider value={{ merchantId: merchant.id, alerts: inbox }}>
      <div className="flex min-h-dvh">
        <Sidebar {...sidebar} initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed"} />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-3 sm:p-4">
          <MobileNav {...sidebar} />
          <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4 lg:px-4">
            {delayed ? (
              <p className="rounded-control bg-warn-bg px-4 py-2.5 text-sm text-warn">Payments are slower than usual right now. Statuses update when NEAR Intents catches up.</p>
            ) : null}
            {/** Any owner can add an existing account to their team, so someone with no business of their own is told whose this is. */}
            {teammateOnly ? (
              <p className="rounded-control bg-info-bg px-4 py-2.5 text-sm text-info">
                {merchant.name} belongs to another account, which added you as a {role}, and its payments go to that owner&apos;s wallet. To accept payments yourself, open the account menu and choose Create a business.
              </p>
            ) : null}
            <main className="min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </DashboardProvider>
  );
}
