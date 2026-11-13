"use client";

import { useScroll, useSpring, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { useRef, type ReactNode } from "react";
import { REDUCED_MOTION_SHOWN } from "@/components/ui/motion";

/** Card that tilts up, grows and fades in as it scrolls toward the middle of the screen; it stays still for reduced motion. */
export function ScrollCard({ className = "", children }: { className?: string; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: card, offset: ["start end", "start 0.6"] });
  const entered = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });
  const scale = useTransform(entered, [0, 1], [0.86, 1]);
  const rotateX = useTransform(entered, [0, 1], [22, 0]);
  const y = useTransform(entered, [0, 1], [70, 0]);
  const opacity = useTransform(entered, [0, 0.6], [0, 1]);
  return (
    <m.div ref={card} style={{ scale, rotateX, y, opacity, transformPerspective: 1000 }} className={`${className} ${REDUCED_MOTION_SHOWN}`}>
      {children}
    </m.div>
  );
}
