"use client";

import { useScroll, useTransform, type MotionValue } from "motion/react";
import * as m from "motion/react-m";
import { useRef } from "react";
import { REDUCED_MOTION_SHOWN } from "@/components/ui/motion";

function Word({ progress, range, children }: { progress: MotionValue<number>; range: [number, number]; children: string }) {
  const opacity = useTransform(progress, range, [0.15, 1]);
  return (
    <>
      <m.span style={{ opacity }} className={REDUCED_MOTION_SHOWN}>
        {children}
      </m.span>{" "}
    </>
  );
}

/** Paragraph whose words light up one after another as it scrolls through the screen. */
export function ScrollText({ text, className = "" }: { text: string; className?: string }) {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: paragraph, offset: ["start 0.85", "end 0.45"] });
  const words = text.split(" ");
  return (
    <p ref={paragraph} className={className}>
      {words.map((word, index) => (
        <Word key={index} progress={scrollYProgress} range={[index / words.length, (index + 1) / words.length]}>
          {word}
        </Word>
      ))}
    </p>
  );
}
