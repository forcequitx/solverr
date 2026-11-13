import type { ReactNode } from "react";

type ChipTone = "success" | "warn" | "danger" | "muted";

const TONES: Record<ChipTone, string> = {
  success: "bg-success-bg text-success",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  muted: "bg-surface-2 text-muted",
};

/** Small square-cornered status chip shown beside a big number. */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${TONES[tone]}`}>{children}</span>;
}

/** Health of a success percent: healthy at or above `healthy`, watch at or above `watch`, low below; no data when nothing finished. */
export function HealthChip({ finished, percent, healthy, watch }: { finished: number; percent: number; healthy: number; watch: number }) {
  if (finished === 0) return <Chip tone="muted">no data</Chip>;
  if (percent >= healthy) return <Chip tone="success">healthy</Chip>;
  if (percent >= watch) return <Chip tone="warn">watch</Chip>;
  return <Chip tone="danger">low</Chip>;
}

/** Percent change against the previous period; nothing when there is no comparable period. */
export function ChangeChip({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? <Chip tone="success">new</Chip> : <Chip tone="muted">steady</Chip>;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return <Chip tone="muted">steady</Chip>;
  return <Chip tone={percent > 0 ? "success" : "danger"}>{`${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`}</Chip>;
}

/** Change in a count against the previous period, such as +3. */
export function CountChangeChip({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  const difference = current - previous;
  if (difference === 0) return <Chip tone="muted">steady</Chip>;
  return <Chip tone={difference > 0 ? "success" : "danger"}>{`${difference > 0 ? "+" : "−"}${Math.abs(difference)}`}</Chip>;
}
