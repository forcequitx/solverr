"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";

type NavItem = { href: string; label: string; icon: IconName };

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/dashboard/payments", label: "Payments", icon: "payments" },
  { href: "/dashboard/links", label: "Payment links", icon: "links" },
  { href: "/dashboard/button", label: "Pay button", icon: "button" },
  { href: "/dashboard/agents", label: "Agents", icon: "agents" },
  { href: "/dashboard/transfers", label: "Refunds & payouts", icon: "transfers" },
  { href: "/dashboard/subscriptions", label: "Subscriptions", icon: "subscriptions" },
  { href: "/dashboard/developers", label: "Developers", icon: "developers" },
];

export const FOOTER_NAV: NavItem[] = [
  { href: "/dashboard/support", label: "Support", icon: "support" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

/** Sidebar links; the current page is a solid blue pill. Collapsed shows icons only; `animate` fades the items in, as for search results. */
export function DashboardNav({ items, collapsed = false, onNavigate, animate = false }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void; animate?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/dashboard" ? pathname === href : pathname.startsWith(href));
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, index) => {
        const active = isActive(item.href);
        return (
          <li key={item.href} className={animate ? "animate-row-in" : undefined} style={animate ? { animationDelay: `${index * 30}ms` } : undefined}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={`flex h-10 items-center gap-3 pointer-coarse:h-11 rounded-[12px] text-sm font-medium transition-colors duration-200 ${FOCUS_RING} ${collapsed ? "justify-center" : "px-3"} ${
                active ? "bg-accent text-accent-ink shadow-[0_0_0_1px_var(--accent-hover),inset_0_1px_0_rgb(255_255_255/0.25)]" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <Icon name={item.icon} className="size-[18px] shrink-0" />
              {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
