import Link from "next/link";
import { DOCS_LABEL } from "@/components/docs/bracket-label";
import { FOCUS_RING } from "@/components/ui/focus-ring";

const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/docs/api", label: "API reference" },
  { href: "/help", label: "Payment help" },
] as const;

/** One ruled line under the docs: the product line on the left, site links on the right. */
export function DocsFooter() {
  return (
    <footer className="border-t border-line px-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 py-[22px] sm:flex-row sm:items-center sm:justify-between">
        <p className={DOCS_LABEL}>Solverr · Payments on NEAR Intents</p>
        <nav aria-label="Site" className="flex flex-wrap gap-x-5 gap-y-1">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={`${DOCS_LABEL} rounded-control transition-colors hover:text-fg pointer-coarse:py-3 ${FOCUS_RING}`}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
