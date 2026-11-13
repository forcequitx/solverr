import type { ReactNode } from "react";

const LABEL_TYPE = "text-[11px] font-semibold uppercase leading-4 text-muted";

/** Small uppercase spaced text of the docs: nested sidebar group names, pager and footer labels. */
export const DOCS_LABEL = `${LABEL_TYPE} tracking-[0.2em]`;

/** A docs section label between accent brackets, such as "[ GET STARTED ]"; the brackets are hidden from screen readers. */
export function BracketLabel({ children, as: Tag = "p", className = "" }: { children: ReactNode; as?: "p" | "span"; className?: string }) {
  return (
    <Tag className={`${LABEL_TYPE} tracking-[0.24em] ${className}`}>
      <span aria-hidden="true" className="text-accent-text">
        [{" "}
      </span>
      {children}
      <span aria-hidden="true" className="text-accent-text">
        {" "}]
      </span>
    </Tag>
  );
}
