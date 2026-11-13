"use client";

import { AnchorProvider, type TableOfContents, TOCItem } from "fumadocs-core/toc";
import { useRef } from "react";
import { BracketLabel } from "@/components/docs/bracket-label";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";

/** "On this page" list on a left rail, like the sidebar; the heading in view carries the accent rail. */
export function DocsToc({ toc }: { toc: TableOfContents }) {
  return (
    <AnchorProvider toc={toc} single>
      <nav
        aria-label="On this page"
        className="sticky top-[60px] max-h-[calc(100dvh-60px)] overflow-y-auto py-10 [scrollbar-width:none]"
      >
        <BracketLabel className="mb-2">On this page</BracketLabel>
        <ul className="flex flex-col border-l-2 border-line">
          {toc.map((item) => (
            <li key={item.url}>
              <TOCItem
                href={item.url}
                className={`-ml-0.5 block border-l-2 border-transparent py-1 text-[13px] leading-[1.4] text-muted transition-colors hover:text-fg data-[active=true]:border-accent data-[active=true]:font-semibold data-[active=true]:text-fg ${
                  item.depth > 2 ? "pl-6" : "pl-3"
                }`}
              >
                {item.title}
              </TOCItem>
            </li>
          ))}
        </ul>
      </nav>
    </AnchorProvider>
  );
}

/** "On this page" for screens without the side column: a row under the page title that opens into the page's headings. */
export function DocsTocMenu({ toc }: { toc: TableOfContents }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={menu} className="group mt-6 border-y border-line xl:hidden">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control ${FOCUS_RING} [&::-webkit-details-marker]:hidden`}>
        <BracketLabel as="span">On this page</BracketLabel>
        <Icon name="chevronDown" className="size-4 text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <nav aria-label="On this page" className="pb-3">
        <ul className="flex flex-col">
          {toc.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                onClick={() => menu.current?.removeAttribute("open")}
                className={`flex min-h-10 items-center rounded-control py-1.5 text-sm font-medium text-muted transition-colors hover:text-fg pointer-coarse:min-h-11 ${FOCUS_RING} ${item.depth > 2 ? "pl-4" : ""}`}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
