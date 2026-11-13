import type * as PageTree from "fumadocs-core/page-tree";
import Link from "next/link";
import { DOCS_LABEL } from "@/components/docs/bracket-label";
import { FOCUS_RING } from "@/components/ui/focus-ring";

function PagerLink({ item, direction }: { item: PageTree.Item; direction: "previous" | "next" }) {
  const next = direction === "next";
  return (
    <Link
      href={item.url}
      className={`flex flex-col gap-0.5 border border-line px-4 py-2.5 transition-colors hover:bg-surface-2 sm:min-w-[190px] sm:max-w-[48%] ${FOCUS_RING} ${next ? "sm:ml-auto sm:text-right" : ""}`}
    >
      <span className={DOCS_LABEL}>{next ? "Next" : "Previous"}</span>
      <span className="text-sm font-medium text-fg">{item.name}</span>
    </Link>
  );
}

/** Previous and next pages in sidebar order. */
export function DocsPager({ previous, next }: { previous?: PageTree.Item; next?: PageTree.Item }) {
  if (!previous && !next) return null;
  return (
    <nav aria-label="More docs" className="mt-14 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row">
      {previous && <PagerLink item={previous} direction="previous" />}
      {next && <PagerLink item={next} direction="next" />}
    </nav>
  );
}
