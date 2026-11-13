"use client";

import type { TooltipContentProps } from "recharts";

type Row = { name: string; value: string; color: string };

/** Hover card for Recharts charts: the bucket title, then one colored row per series. */
export function ChartTooltip({ active, payload, title, rows }: Pick<TooltipContentProps<number, string>, "active" | "payload"> & { title: (point: Record<string, unknown>) => string; rows: (point: Record<string, unknown>) => Row[] }) {
  const point = payload?.[0]?.payload as Record<string, unknown> | undefined;
  if (!active || !point) return null;
  return (
    <div className="min-w-40 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-meta text-fg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]">
      <p className="mb-1.5 font-medium">{title(point)}</p>
      <ul className="flex flex-col gap-1">
        {rows(point).map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-[3px]" style={{ background: row.color }} />
              {row.name}
            </span>
            <span className="font-semibold tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
