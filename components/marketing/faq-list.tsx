"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { Reveal } from "@/components/marketing/reveal";
import { Icon } from "@/components/ui/icon";
import { EXPAND_MOTION } from "@/components/ui/motion";

/** Questions that open one at a time, each answer sliding open below its question. */
export function FaqList({ items }: { items: readonly (readonly [question: string, answer: string])[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto mt-14 flex max-w-[680px] flex-col gap-3">
      {items.map(([question, answer], index) => {
        const expanded = open === index;
        const answerId = `faq-answer-${index}`;
        const questionId = `faq-question-${index}`;
        return (
          <Reveal key={question} delay={index * 0.06}>
            <div className={`rounded-[14px] border bg-surface px-5 transition-colors duration-300 ${expanded ? "border-accent/40" : "border-line hover:border-accent/25"}`}>
              <h3 className="font-sans">
                <button
                  id={questionId}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? answerId : undefined}
                  onClick={() => setOpen(expanded ? null : index)}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium"
                >
                  {question}
                  <m.span animate={{ rotate: expanded ? 45 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className="shrink-0 text-muted">
                    <Icon name="plus" className="size-4" />
                  </m.span>
                </button>
              </h3>
              <AnimatePresence initial={false}>
                {expanded ? (
                  <m.div key="answer" id={answerId} role="region" aria-labelledby={questionId} {...EXPAND_MOTION} className="overflow-hidden">
                    <p className="pb-5 text-muted">{answer}</p>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
