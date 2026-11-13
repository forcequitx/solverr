"use client";

import type { PointerEvent, ReactNode } from "react";

function followPointer(event: PointerEvent<HTMLDivElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
}

/** Card that lifts on hover and carries a soft blue light that follows the pointer. */
export function SpotlightCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div onPointerMove={followPointer} className={`group transition-[translate,border-color] duration-500 hover:-translate-y-1 hover:border-accent/30 ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 [background:radial-gradient(420px_circle_at_var(--spot-x,50%)_var(--spot-y,50%),color-mix(in_srgb,var(--accent)_18%,transparent),transparent_70%)]"
      />
      {children}
    </div>
  );
}
