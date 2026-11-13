"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { LogoMark, WORDMARK } from "@/components/brand/logo";
import { Drawer } from "@/components/ui/drawer";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";

export type SiteLink = { href: string; label: string; icon: IconName };

/** Phone menu for the site header: an icon button that opens the page links in a drawer from the left. */
export function SiteMenu({ links }: { links: readonly SiteLink[] }) {
  const [open, setOpen] = useState(false);
  /** The portal needs `document`, so it mounts on the first open and stays for the closing animation. */
  const [used, setUsed] = useState(open);
  if (open && !used) setUsed(true);

  const drawer = (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label="Site menu"
      className="h-fit"
      header={
        <span className="flex items-center gap-2.5">
          <LogoMark className="size-8 shrink-0" />
          <span className={`text-[15px] ${WORDMARK}`}>Solverr</span>
        </span>
      }
    >
      <nav aria-label="Site">
        <ul className="flex flex-col gap-0.5">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center gap-2.5 rounded-[12px] px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}
              >
                <Icon name={link.icon} className="size-[18px] shrink-0" />
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Drawer>
  );

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`grid size-10 shrink-0 place-items-center rounded-control text-fg pointer-coarse:size-11 hover:bg-surface-2 ${FOCUS_RING} md:hidden`}
      >
        <Icon name="menu" className="size-5" />
      </button>
      {/** Portaled to <body>: the header pill's blur and drop-in animation would otherwise anchor this fixed layer to the pill. */}
      {used ? createPortal(drawer, document.body) : null}
    </>
  );
}
