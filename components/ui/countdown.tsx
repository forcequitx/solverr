"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { format } from "@/lib/i18n/interpolate";

function remaining(until: string): number {
  return Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
}

/** mm:ss until `until`; calls `onExpire` once when it reaches zero. `label` is the spoken time, with `{minutes}` and `{seconds}`. */
export function Countdown({ until, label, onExpire }: { until: string; label: string; onExpire?: () => void }) {
  const [tick, setTick] = useState(() => ({ until, seconds: remaining(until) }));
  /** A new `until` shows its own time at once instead of the old one until the next tick. */
  if (tick.until !== until) setTick({ until, seconds: remaining(until) });
  const seconds = tick.seconds;
  const expire = useEffectEvent(() => onExpire?.());

  useEffect(() => {
    const timer = setInterval(() => {
      const next = remaining(until);
      setTick({ until, seconds: next });
      if (next === 0) {
        clearInterval(timer);
        expire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);

  const minutes = Math.floor(seconds / 60);
  /** Server and browser read the clock a moment apart, so the first value may differ by a second; screen readers get the time in words. */
  return (
    <span className="font-mono tabular-nums">
      <span aria-hidden="true" suppressHydrationWarning>
        {String(minutes).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <span className="sr-only" suppressHydrationWarning>
        {format(label, { minutes, seconds: seconds % 60 })}
      </span>
    </span>
  );
}
