"use client";

import { useScroll, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { Fragment, useRef } from "react";
import { Glow } from "@/components/marketing/glow";
import { Accent } from "@/components/marketing/section-heading";
import { ButtonLink } from "@/components/ui/button";
import { ChainBadge } from "@/components/ui/chain-badge";
import { EASE_OUT, REDUCED_MOTION_SHOWN } from "@/components/ui/motion";
import type { ChainInfo } from "@/lib/chains/registry";

/** Headline pieces in reading order; the accent phrase blurs in as one piece. */
const HEADLINE: readonly { text: string; accent?: boolean }[] = [
  { text: "Get" },
  { text: "paid" },
  { text: "by" },
  { text: "humans" },
  { text: "and" },
  { text: "AI" },
  { text: "agents," },
  { text: "in" },
  { text: "any coin.", accent: true },
];

const HEADLINE_START = 0.35;
const WORD_GAP = 0.08;
const SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;

/** Landing hero: chain logos, headline, pitch and buttons arrive in sequence, and drift away with a glow on scroll. */
export function Hero({ chains, chainCount }: { chains: Pick<ChainInfo, "id" | "name" | "color">[]; chainCount: number }) {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -140]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const glowY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const glowScale = useTransform(scrollYProgress, [0, 1], [1, 1.35]);
  const textDone = HEADLINE_START + HEADLINE.length * WORD_GAP;

  return (
    <section ref={section} className="relative px-4 pb-32 pt-32 sm:px-8 sm:pb-74 sm:pt-44">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <m.div style={{ y: glowY, scale: glowScale }} className={`absolute inset-0 ${REDUCED_MOTION_SHOWN}`}>
          <m.div
            initial={{ opacity: 0, scale: 0.4, y: 80 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1.8, ease: EASE_OUT, delay: 0.5 }}
            className="absolute inset-0"
          >
            <Glow wide className="left-1/2 top-[48%] size-[min(680px,130vw)] -translate-x-1/2 -translate-y-1/2 animate-glow-breathe opacity-20" />
          </m.div>
        </m.div>
      </div>

      <m.div style={{ y: contentY, opacity: contentOpacity }} className={`mx-auto flex max-w-[900px] flex-col items-center text-center ${REDUCED_MOTION_SHOWN}`}>
        <div className="flex -space-x-2">
          {chains.map((chain, index) => (
            <m.span
              key={chain.id}
              initial={{ opacity: 0, scale: 0, x: -14, rotate: -30 }}
              animate={{ opacity: 1, scale: 1, x: 0, rotate: 0 }}
              transition={{ ...SPRING, delay: 0.15 + index * 0.07 }}
              className="flex rounded-full ring-2 ring-bg"
            >
              <ChainBadge chain={chain} className="size-8 text-xs" />
            </m.span>
          ))}
        </div>

        <h1 className="mt-7 text-balance text-[44px] font-medium leading-[1.08] tracking-[-0.04em] sm:text-[80px] sm:leading-[1.1]">
          {HEADLINE.map(({ text, accent }, index) => (
            <Fragment key={text + index}>
              <m.span
                initial={{ y: "0.4em", opacity: 0, filter: "blur(12px)" }}
                animate={{ y: "0em", opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: 1, ease: EASE_OUT, delay: HEADLINE_START + index * WORD_GAP }}
                className={`inline-block ${REDUCED_MOTION_SHOWN}`}
              >
                {accent ? <Accent sheen>{text}</Accent> : text}
              </m.span>{" "}
            </Fragment>
          ))}
        </h1>

        <m.p
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: textDone }}
          className={`mt-6 max-w-[560px] text-lg text-muted sm:text-xl ${REDUCED_MOTION_SHOWN}`}
        >
          One checkout for {chainCount} chains. NEAR Intents converts every payment and settles it straight into your wallet. 0% gateway fee, no custody.
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...SPRING, delay: textDone + 0.15 }}
          className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row"
        >
          <ButtonLink href="/signup" variant="primary" size="md">
            Start accepting payments
          </ButtonLink>
          <ButtonLink href="/docs" variant="secondary" size="md">
            Read the docs
          </ButtonLink>
        </m.div>
      </m.div>
    </section>
  );
}
