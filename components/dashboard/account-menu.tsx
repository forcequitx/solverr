"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useRouter } from "next/navigation";
import { type KeyboardEvent as ReactKeyboardEvent, useId, useRef, useState, useTransition } from "react";
import { callAction, UNREACHABLE } from "@/components/dashboard/use-action";
import { ActionError } from "@/components/ui/action-error";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { POPOVER_UP_MOTION } from "@/components/ui/motion";
import { usePopoverDismiss } from "@/components/ui/use-popover-dismiss";
import { MerchantMark } from "@/components/ui/merchant-mark";
import { switchMerchantAction } from "@/lib/merchants/actions/account";

export type BusinessOption = { id: string; name: string; logoUrl: string | null; role: "owner" | "developer" | "viewer" };

const ROLE_LABELS = { owner: "Owner", developer: "Developer", viewer: "Viewer" } as const;
const MENU_ITEM = `flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm pointer-coarse:min-h-11 ${FOCUS_RING}`;

/** The menu's items that can take focus, in order. */
const menuItems = (list: HTMLElement | null) => Array.from(list?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

/** Account card at the bottom of the sidebar: switch business, start a new one, or sign out. */
export function AccountMenu({
  businesses,
  currentId,
  userName,
  collapsed = false,
  onNavigate,
}: {
  businesses: BusinessOption[];
  currentId: string;
  userName: string;
  collapsed?: boolean;
  /** Runs when a choice leaves the current page, so the phone menu around it can close. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = businesses.find((business) => business.id === currentId) ?? businesses[0];

  /** Opening moves focus to the current business, or to the first item. */
  usePopoverDismiss(
    open,
    { root, trigger: button, panel: menu },
    () => setOpen(false),
    (list) => list.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ?? menuItems(list)[0],
  );

  /** Arrow keys, Home and End move between items (wrapping at the ends); Tab closes the menu. */
  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") return setOpen(false);
    const items = menuItems(event.currentTarget);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = { ArrowDown: (index + 1) % items.length, ArrowUp: index <= 0 ? items.length - 1 : index - 1, Home: 0, End: items.length - 1 };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    items[target].focus();
  }

  /** A failed switch or sign-out reopens the menu with the reason inside it. */
  const fail = (message: string) => {
    setError(message);
    setOpen(true);
  };

  const choose = (id: string) =>
    start(async () => {
      setError(null);
      setOpen(false);
      if (id === currentId) return;
      const result = await callAction(() => switchMerchantAction(id));
      if (result.ok) {
        onNavigate?.();
        router.push("/dashboard");
      } else fail(result.error);
    });

  const signOut = () =>
    start(async () => {
      setError(null);
      const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
      if (!response) return fail(UNREACHABLE);
      if (!response.ok) return fail("Sign-out did not complete. Try again.");
      router.push("/signin");
      router.refresh();
    });

  if (!current) return null;

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        title={collapsed ? current.name : undefined}
        className={`flex w-full items-center gap-3 rounded-[14px] bg-surface-2 text-left transition-colors hover:bg-line/60 ${FOCUS_RING} ${collapsed ? "justify-center p-1.5" : "p-2.5"}`}
      >
        <MerchantMark name={current.name} logoUrl={current.logoUrl} variant="account" />
        {collapsed ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{current.name}</span>
              <span className="truncate text-xs text-muted">
                {ROLE_LABELS[current.role]} · {userName}
              </span>
            </span>
            <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-surface text-muted shadow-card">
              <Icon name="chevronUpDown" className="size-3.5" />
            </span>
          </>
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <m.div
            {...POPOVER_UP_MOTION}
            style={{ transformOrigin: "bottom left" }}
            className={`absolute bottom-full z-40 mb-2 flex w-64 flex-col gap-0.5 rounded-[16px] border border-line bg-surface p-1.5 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.25)] ${collapsed ? "left-0" : "inset-x-0 w-auto"}`}
          >
            <div ref={menu} id={menuId} role="menu" aria-label="Businesses" onKeyDown={onMenuKeyDown} className="flex flex-col gap-0.5">
              <p aria-hidden className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">
                Businesses
              </p>
              {businesses.map((business) => (
                <button
                  key={business.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={business.id === currentId}
                  tabIndex={-1}
                  disabled={pending}
                  onClick={() => choose(business.id)}
                  className={`${MENU_ITEM} hover:bg-surface-2 disabled:opacity-60`}
                >
                  <MerchantMark name={business.name} logoUrl={business.logoUrl} variant="option" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{business.name}</span>
                    <span className="text-xs text-muted">{ROLE_LABELS[business.role]}</span>
                  </span>
                  {business.id === currentId ? <Icon name="check" className="size-4 text-accent-text" /> : null}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  onNavigate?.();
                  router.push("/onboarding?new=1");
                }}
                className={`${MENU_ITEM} font-medium hover:bg-surface-2`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-line text-muted">
                  <Icon name="plus" className="size-3.5" />
                </span>
                Create a business
              </button>
              <div role="separator" className="my-1 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={pending}
                onClick={signOut}
                className={`${MENU_ITEM} font-medium text-danger hover:bg-danger-bg disabled:opacity-60`}
              >
                <Icon name="logout" className="size-4" />
                Sign out
              </button>
            </div>
            {/** The reason sits outside the menu role, which allows only menu items, but inside the same card. */}
            <ActionError message={error} tone="danger" className="px-2.5 pb-1" />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
