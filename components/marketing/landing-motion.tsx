"use client";

import { ReactLenis } from "lenis/react";
import "lenis/dist/lenis.css";
import { MotionConfig, useScroll, useSpring } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";

/** Landing page shell: Lenis smooth scrolling, Motion that follows the reduced-motion setting, and a scroll progress bar. */
export function LandingMotion({ children }: { children: ReactNode }) {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  return (
    <ReactLenis root options={{ lerp: 0.09, anchors: { offset: -96 }, stopInertiaOnNavigate: true }}>
      <MotionConfig reducedMotion="user">
        <m.div
          aria-hidden="true"
          style={{ scaleX: progress }}
          className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-[linear-gradient(90deg,var(--accent),var(--chart-3),var(--logo-bottom))]"
        />
        {children}
      </MotionConfig>
    </ReactLenis>
  );
}
