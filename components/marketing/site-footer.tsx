import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NAV_LINKS } from "@/components/marketing/site-header";

const FOOTER_COLUMNS: readonly { title: string; links: readonly { href: string; label: string }[] }[] = [
  { title: "Product", links: NAV_LINKS },
  { title: "Business", links: [{ href: "/signup", label: "Get started" }] },
  { title: "Customers", links: [{ href: "/help", label: "Payment help" }] },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-line">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-10 px-4 py-14 sm:flex-row sm:justify-between sm:px-8">
        <div className="max-w-xs">
          <Logo className="text-2xl!" />
          <p className="mt-3 text-sm text-muted">Get paid by humans and AI agents, in any coin, straight into your own wallet.</p>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-8 text-sm sm:gap-x-16">
          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title} className="flex flex-col gap-3 pointer-coarse:gap-0">
              <p className="font-semibold pointer-coarse:mb-1">{column.title}</p>
              {column.links.map((link) => (
                <Link key={link.href} href={link.href} className="text-muted transition-colors pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center hover:text-fg">
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
