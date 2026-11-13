import { Segmented } from "@/components/ui/segmented";
import type { Period } from "@/lib/merchants/stat-periods";

const PERIODS: readonly Period[] = ["7d", "30d", "12m"];

export const PERIOD_LABELS: Record<Period, string> = { "7d": "7 days", "30d": "30 days", "12m": "12 months" };

const OPTIONS = PERIODS.map((period) => ({ value: period, label: PERIOD_LABELS[period] }));

/** 7 days / 30 days / 12 months switch with a sliding highlight. */
export function PeriodTabs({ value, onChange, label }: { value: Period; onChange: (period: Period) => void; label: string }) {
  return <Segmented options={OPTIONS} value={value} onChange={onChange} label={label} />;
}
