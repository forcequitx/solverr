"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LogoMark, WORDMARK } from "@/components/brand/logo";
import { AccountMenu, type BusinessOption } from "@/components/dashboard/account-menu";
import { DashboardNav, FOOTER_NAV, MAIN_NAV } from "@/components/dashboard/nav";
import { SIDEBAR_COOKIE } from "@/components/dashboard/sidebar-cookie";
import { Drawer } from "@/components/ui/drawer";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { isInvoiceId } from "@/lib/invoices/invoice-id";

type SidebarProps = { businesses: BusinessOption[]; currentId: string; businessName: string; userName: string };

/** Logo, search, navigation and account controls; shared by the desktop sidebar and the phone drawer. */
function SidebarBody({ businesses, currentId, businessName, userName, collapsed, onToggle, onNavigate }: SidebarProps & { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  /** Set by the collapsed sidebar's Search button, so the search field takes focus once the sidebar expands. */
  const focusSearch = useRef(false);
  const term = query.trim().toLowerCase();
  const matches = term ? [...MAIN_NAV, ...FOOTER_NAV].filter((item) => item.label.toLowerCase().includes(term)) : MAIN_NAV;

  const submit = () => {
    const value = query.trim();
    if (!value) return;
    if (isInvoiceId(value)) router.push(`/dashboard/payments/${value}`);
    else if (matches.length > 0) router.push(matches[0].href);
    else return;
    setQuery("");
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className={`flex items-center gap-2.5 ${collapsed ? "flex-col" : "px-1"}`}>
        <Link href="/dashboard" onClick={onNavigate} aria-label="Overview" className="flex min-w-0 flex-1 items-center gap-2.5">
          <LogoMark className="size-8 shrink-0" />
          {collapsed ? null : (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className={`truncate text-[15px] ${WORDMARK}`}>Solverr</span>
              <span className="truncate text-xs text-muted">{businessName}</span>
            </span>
          )}
        </Link>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`grid size-8 shrink-0 place-items-center rounded-[8px] border border-line text-muted transition-colors pointer-coarse:size-11 hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}
          >
            <Icon name="sidebar" className="size-4" />
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => {
            focusSearch.current = true;
            onToggle?.();
          }}
          aria-label="Search"
          className="mx-auto grid size-10 place-items-center rounded-[12px] bg-surface-2 text-muted hover:text-fg"
        >
          <Icon name="search" className="size-[18px]" />
        </button>
      ) : (
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex h-10 items-center gap-2 rounded-[12px] bg-surface-2 px-3 text-muted pointer-coarse:h-11 pointer-coarse:pr-1 transition-shadow duration-200 focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent"
        >
          <Icon name="search" className={`size-4 shrink-0 transition-colors duration-200 ${term ? "text-accent-text" : ""}`} />
          <input
            ref={(input) => {
              if (input && focusSearch.current) {
                focusSearch.current = false;
                input.focus();
              }
            }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setQuery("")}
            placeholder="Search pages or payment ID"
            aria-label="Search pages or payment ID"
            className="min-w-0 flex-1 bg-transparent text-field text-fg outline-none placeholder:text-muted"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="grid size-5 shrink-0 animate-fade-in place-items-center rounded-full text-muted pointer-coarse:size-10 hover:text-fg">
              <span className="grid size-5 place-items-center rounded-full bg-line/70">
                <Icon name="close" className="size-3" />
              </span>
            </button>
          ) : null}
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {matches.length === 0 ? (
          <p key={term} className="animate-fade-in px-3 py-2 text-meta text-muted">
            {isInvoiceId(query.trim()) ? "Press Enter to open this payment." : "No page matches your search."}
          </p>
        ) : (
          <DashboardNav key={term} items={matches} collapsed={collapsed} onNavigate={onNavigate} animate={Boolean(term)} />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <ThemeToggle collapsed={collapsed} />
        <DashboardNav items={FOOTER_NAV} collapsed={collapsed} onNavigate={onNavigate} />
        <div className="mt-2">
          <AccountMenu businesses={businesses} currentId={currentId} userName={userName} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}

/** Desktop sidebar card that can collapse to icons; the choice is kept in a cookie. */
export function Sidebar({ initialCollapsed, ...props }: SidebarProps & { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 py-3 pl-3 sm:py-4 sm:pl-4 md:block">
      <div className={`h-full rounded-card border border-line bg-surface p-3 shadow-card transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-60"}`}>
        <SidebarBody {...props} collapsed={collapsed} onToggle={toggle} />
      </div>
    </aside>
  );
}

/** Phone top bar, pinned while the page scrolls, with a menu button that opens the sidebar as a drawer. */
export function MobileNav(props: SidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-30 -mx-3 -mt-3 bg-bg px-3 pt-3 sm:-mx-4 sm:-mt-4 sm:px-4 sm:pt-4 md:hidden">
      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-3 py-2.5 shadow-card">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
          <LogoMark className="size-8 shrink-0" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className={`truncate text-[15px] ${WORDMARK}`}>Solverr</span>
            <span className="truncate text-xs text-muted">{props.businessName}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className={`grid size-11 place-items-center rounded-control border border-line text-fg hover:bg-surface-2 ${FOCUS_RING}`}
        >
          <Icon name="menu" className="size-[18px]" />
        </button>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} label="Menu">
        <SidebarBody {...props} collapsed={false} onNavigate={() => setOpen(false)} />
      </Drawer>
    </div>
  );
}
