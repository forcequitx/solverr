import type { ReactNode } from "react";

/** Gray header row of a list card's table; `action` heads a last, right-aligned column for row actions. */
export function ListTableHead({ labels, action }: { labels: string[]; action?: ReactNode }) {
  return (
    <thead>
      <tr className="bg-surface-2 text-left text-xs text-muted">
        {labels.map((label) => (
          <th key={label} scope="col" className="px-4 py-2.5 font-medium first:pl-6 last:pr-6">
            {label}
          </th>
        ))}
        {action ? (
          <th scope="col" className="px-4 py-2.5 pr-6 text-right font-medium">
            {action}
          </th>
        ) : null}
      </tr>
    </thead>
  );
}
