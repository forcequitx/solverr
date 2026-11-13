import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { DocsFooter } from "@/components/docs/docs-footer";
import { DocsHeader } from "@/components/docs/docs-header";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { source } from "@/lib/docs/source";

export default function Layout({ children }: { children: ReactNode }) {
  const tree = source.getPageTree();
  return (
    /** Docs search (and its Ctrl+K shortcut) lives only here; Fumadocs' theme handling stays off because the app sets data-theme itself. */
    <RootProvider theme={{ enabled: false }}>
      <div className="flex min-h-dvh flex-col">
        <DocsHeader tree={tree} />
        <div className="flex-1 px-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-[1280px] gap-16">
            <aside className="sticky top-[60px] hidden h-[calc(100dvh-60px)] w-[210px] shrink-0 self-start overflow-y-auto py-10 [scrollbar-width:none] md:block">
              <DocsSidebar tree={tree} />
            </aside>
            {children}
          </div>
        </div>
        <DocsFooter />
      </div>
    </RootProvider>
  );
}
