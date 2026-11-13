"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { BracketLabel, DOCS_LABEL } from "@/components/docs/bracket-label";
import { activeDocsTab, docsTabs } from "@/components/docs/docs-tabs";
import { FOCUS_RING } from "@/components/ui/focus-ring";

/** Navigation of the current docs tab: top-level separators and folders are bracket-labelled groups of links on a left rail, separators inside
    a folder get a plain label, and the current page carries an accent rail. */
export function DocsSidebar({ tree, onNavigate }: { tree: PageTree.Root; onNavigate?: () => void }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  /** Long groups (such as the API reference) push the current page out of view; this scrolls it back. */
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  const renderPage = (item: PageTree.Item) => {
    const active = pathname === item.url;
    return (
      <li key={item.url}>
        <Link
          href={item.url}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-8 items-start gap-2.5 border-l-2 py-[5px] pl-3 pr-2 text-sm transition-colors duration-200 pointer-coarse:min-h-11 pointer-coarse:py-3 ${FOCUS_RING} ${
            active ? "border-accent bg-surface-2 font-semibold text-fg" : "border-line text-muted hover:text-fg"
          }`}
        >
          {/** API pages carry a method badge, which stays beside the first line when a long page name wraps. */}
          {item.icon ? <span className="flex h-5 shrink-0 items-center">{item.icon}</span> : null}
          <span className="min-w-0 leading-5">{item.name}</span>
        </Link>
      </li>
    );
  };

  const renderNodes = (nodes: PageTree.Node[], nested: boolean) =>
    nodes.map((node, index) => {
      if (node.type === "page") return renderPage(node);
      if (node.type === "separator") {
        /** An unnamed separator only ends the group above it. */
        if (!node.name) return null;
        return (
          <li key={node.$id ?? `separator-${index}`} className={nested ? "" : "mt-[22px] first:mt-0"}>
            {nested ? <p className={`mb-1.5 mt-3 pl-3.5 ${DOCS_LABEL}`}>{node.name}</p> : <BracketLabel className="mb-2">{node.name}</BracketLabel>}
          </li>
        );
      }
      return (
        <li key={node.$id ?? `folder-${index}`} className="mt-[22px] first:mt-0">
          <BracketLabel className="mb-2">{node.name}</BracketLabel>
          <ul className="flex flex-col">
            {node.index && renderPage(node.index)}
            {renderNodes(node.children, true)}
          </ul>
        </li>
      );
    });

  return (
    <nav ref={navRef} aria-label="Docs">
      <ul className="flex flex-col">{renderNodes(activeDocsTab(docsTabs(tree), pathname).nodes, false)}</ul>
    </nav>
  );
}
