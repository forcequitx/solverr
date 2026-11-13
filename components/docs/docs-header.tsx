"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoMark, WORDMARK } from "@/components/brand/logo";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { activeDocsTab, docsTabs } from "@/components/docs/docs-tabs";
import { ButtonLink } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useDarkMode } from "@/components/ui/use-dark-mode";

const ICON_BUTTON = `grid size-9 shrink-0 place-items-center rounded-[8px] text-muted transition-colors pointer-coarse:size-11 hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`;
const NAV_LINK = `rounded-[8px] px-3 py-1.5 text-sm text-muted transition-colors hover:text-fg pointer-coarse:py-3 aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold aria-[current=page]:text-fg ${FOCUS_RING}`;

/** The docs tabs (Documentation, API reference); each tab opens its first page. The logo links to the home page. */
function DocsNavLinks({ tree, className = "", onNavigate }: { tree: PageTree.Root; className?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const tabs = docsTabs(tree);
  const active = activeDocsTab(tabs, pathname);
  return (
    <nav aria-label="Docs sections" className={`flex gap-0.5 ${className}`}>
      {tabs.map((tab) => (
        <Link key={tab.value} href={tab.url} onClick={onNavigate} aria-current={tab.value === active.value ? "page" : undefined} className={NAV_LINK}>
          {tab.title}
        </Link>
      ))}
    </nav>
  );
}

/** Docs top bar: logo, section links, search, dark mode and a link to the dashboard; on phones a menu button opens the docs navigation as a drawer. */
export function DocsHeader({ tree }: { tree: PageTree.Root }) {
  const { setOpenSearch, hotKey } = useSearchContext();
  const [dark, toggleDark] = useDarkMode();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/** Padding outside the 1280px column, as in the docs layout below, so the logo lines up with the sidebar. */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 px-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex h-[60px] w-full max-w-[1280px] items-center gap-7">
          <Link href="/" aria-label="Solverr home" className={`flex shrink-0 items-center gap-2 rounded-control pointer-coarse:min-h-11 ${FOCUS_RING}`}>
            <LogoMark className="size-6 shrink-0" />
            <span className={`text-[17px] ${WORDMARK}`}>Solverr</span>
          </Link>
          <DocsNavLinks tree={tree} className="hidden md:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpenSearch(true)}
              className={`hidden h-9 w-52 items-center gap-2 rounded-[8px] border border-line px-3 text-sm text-muted transition-colors hover:text-fg ${FOCUS_RING} lg:flex`}
            >
              <Icon name="search" className="size-4 shrink-0" />
              <span className="flex-1 text-left">Search docs</span>
              <kbd className="flex items-center gap-0.5 rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-muted">
                {hotKey.map((key, index) => (
                  <span key={index}>{key.display}</span>
                ))}
              </kbd>
            </button>
            <button type="button" aria-label="Search docs" onClick={() => setOpenSearch(true)} className={`lg:hidden ${ICON_BUTTON}`}>
              <Icon name="search" className="size-[18px]" />
            </button>
            <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={toggleDark} className={`hidden sm:grid ${ICON_BUTTON}`}>
              <Icon name="moon" className="size-[18px] dark:hidden" />
              <Icon name="sun" className="hidden size-[18px] dark:block" />
            </button>
            <div className="ml-1.5 hidden md:block">
              <ButtonLink href="/dashboard" variant="strong" size="sm">
                Open dashboard
              </ButtonLink>
            </div>
            <button type="button" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className={`md:hidden ${ICON_BUTTON}`}>
              <Icon name="menu" className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        label="Docs menu"
        header={
          <span className="flex items-center gap-2">
            <LogoMark className="size-6 shrink-0" />
            <span className={`text-[17px] ${WORDMARK}`}>Solverr</span>
          </span>
        }
      >
        <DocsNavLinks tree={tree} className="flex-col" onNavigate={() => setMenuOpen(false)} />
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
          <DocsSidebar tree={tree} onNavigate={() => setMenuOpen(false)} />
        </div>
        <ThemeToggle />
        <ButtonLink href="/dashboard" variant="strong" size="sm" className="w-full">
          Open dashboard
        </ButtonLink>
      </Drawer>
    </>
  );
}
