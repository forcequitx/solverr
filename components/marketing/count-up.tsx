"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatedNumber, type NumberFormat } from "@/components/ui/animated-number";

/** Share of the number that must be on screen to count as seen. */
const VISIBLE_RATIO = 0.6;

/** A number that rolls from `from` to `to` the first time it scrolls into view.
    Server HTML shows the real value (crawlers and no-JS visitors never see `from`); a number on screen at load keeps it and never rolls. */
export function CountUp({ from, to, format, prefix, suffix, className }: { from: number; to: number; format?: NumberFormat; prefix?: string; suffix?: string; className?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  /** "waiting" only when the first visibility report found the number off screen; it then shows `from` until seen. */
  const [phase, setPhase] = useState<"unknown" | "waiting" | "seen">("unknown");

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= VISIBLE_RATIO) {
          setPhase("seen");
          observer.disconnect();
        } else {
          setPhase((current) => (current === "unknown" ? "waiting" : current));
        }
      },
      { threshold: VISIBLE_RATIO },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={element} className={className}>
      {prefix}
      <AnimatedNumber value={phase === "waiting" ? from : to} format={format} suffix={suffix} />
    </span>
  );
}
