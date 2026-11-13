import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { SiteMenu, type SiteLink } from "@/components/marketing/site-menu";
import { ButtonLink } from "@/components/ui/button";

const NAV_LINK = "rounded-control px-3 py-1.5 transition-colors pointer-coarse:py-3 hover:bg-surface-2 hover:text-fg";

/** Page links in the header, the phone menu and the footer's Product column. */
export const NAV_LINKS: readonly SiteLink[] = [
  { href: "/#how", label: "How it works", icon: "list" },
  { href: "/#features", label: "Features", icon: "zap" },
  { href: "/docs", label: "Docs", icon: "book" },
  { href: "/demo", label: "Demo", icon: "store" },
];

/** Site top bar: a floating glass pill fixed to the top, with the logo, page links (a menu on phones) and the Get started button. */
export function SiteHeader() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4 sm:pt-6">
      <div className="pointer-events-auto flex h-[60px] w-full animate-nav-drop items-center gap-2 rounded-[14px] border border-line bg-bg/60 px-2.5 backdrop-blur-[10px] sm:w-auto sm:gap-6">
        <SiteMenu links={NAV_LINKS} />
        <Link href="/" aria-label="Solverr home" className="grid size-10 place-items-center rounded-control pointer-coarse:size-11 hover:bg-surface-2">
          <LogoMark className="size-7" />
        </Link>
        <nav aria-label="Main" className="hidden items-center text-sm font-medium text-muted md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={NAV_LINK}>
              {link.label}
            </Link>
          ))}
        </nav>
        {/** One entry for everyone: setup starts with signing in, and a returning user lands on the dashboard. */}
        <ButtonLink href="/signup" variant="primary" size="sm" className="ml-auto sm:ml-0">
          Get started
        </ButtonLink>
      </div>
    </header>
  );
}
