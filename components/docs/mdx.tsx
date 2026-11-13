import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { docsIcon } from "@/components/docs/docs-icon";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";
import { source } from "@/lib/docs/source";

type CalloutType = "info" | "warn" | "error";

const CALLOUT_STYLES: Record<CalloutType, { rail: string; icon: IconName; iconColor: string }> = {
  info: { rail: "border-l-accent", icon: "info", iconColor: "text-accent-text" },
  warn: { rail: "border-l-(--chart-4)", icon: "alert", iconColor: "text-warn" },
  error: { rail: "border-l-danger", icon: "alert", iconColor: "text-danger" },
};

/** Column headings are small uppercase labels on a gray band; rows are ruled, and the first column names the row. */
const TABLE =
  "w-full text-sm [&_th]:border-0 [&_th]:bg-surface-2 [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-4 [&_th]:tracking-[0.16em] [&_th]:text-muted [&_td]:border-x-0 [&_td]:border-b-0 [&_td]:border-t [&_td]:border-line [&_td]:px-3.5 [&_td]:py-3 [&_td]:align-top [&_td:first-child]:font-semibold [&_td:first-child]:text-fg [&_thead]:border-0 [&_tr]:border-0";

function Callout({ type = "info", children }: { type?: CalloutType; children?: ReactNode }) {
  const style = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info;
  return (
    <div role="note" className={`not-prose my-6 flex gap-3 border border-l-2 border-line px-4 py-3.5 text-sm leading-6 text-fg ${style.rail}`}>
      <Icon name={style.icon} className={`mt-[3px] size-4 shrink-0 ${style.iconColor}`} />
      <div className="min-w-0 flex-1 [&_a]:font-semibold [&_a]:text-accent-text [&_a]:underline [&_code]:rounded-[6px] [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_p+p]:mt-2">
        {children}
      </div>
    </div>
  );
}

function Cards({ children }: { children?: ReactNode }) {
  return <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}

/** A linked card; `icon` is an icon name, and without one the card shows the icon of the docs page it links to. */
function Card({ title, description, href, icon }: { title: ReactNode; description: ReactNode; href: string; icon?: string }) {
  const pageIcon = docsIcon(icon ?? source.getPageByHref(href)?.page.data.icon);
  return (
    <Link href={href} className={`group flex flex-col gap-2 border border-line p-4 transition-colors duration-200 hover:bg-surface-2 ${FOCUS_RING}`}>
      {pageIcon && <span className="text-accent-text [&_svg]:size-[18px]">{pageIcon}</span>}
      <span className="flex items-start gap-1.5 text-[15px] font-semibold text-fg">
        {title}
        <Icon name="arrowRight" className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="text-sm leading-6 text-muted">{description}</span>
    </Link>
  );
}

/** Code blocks in a square frame at 14px with a 24px line height, one step below body text. */
function CodeBlockPre(props: ComponentProps<"pre">) {
  return (
    <CodeBlock {...props} className={`rounded-none ${props.className ?? ""}`} viewportProps={{ className: "text-sm leading-6" }}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
}

/** Tables in a bordered frame; a wide table scrolls inside it. */
function Table(props: ComponentProps<"table">) {
  return (
    <div tabIndex={0} className={`prose-no-margin relative my-6 overflow-auto border border-line ${FOCUS_RING}`}>
      <table {...props} className={TABLE} />
    </div>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, pre: CodeBlockPre, table: Table, Callout, Cards, Card, ...components } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
