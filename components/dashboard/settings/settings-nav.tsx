"use client";

import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";

export type SettingsSection = { id: string; title: string };

/** A section counts as in view once its top passes this share of the window height. */
const ACTIVE_LINE = 0.3;

/** In-page links to each settings section: a sticky list on desktop, a row of pills on phones; the section in view is highlighted. */
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);
  const reduceMotion = useReducedMotion();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * ACTIVE_LINE;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = sections[0]?.id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= line) current = section.id;
      }
      setActive(atBottom ? sections.at(-1)?.id : current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);

  /** In the row of pills, which scrolls sideways on phones, the highlighted pill is kept in view. */
  useEffect(() => {
    const row = list.current;
    const pill = row?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!row || !pill || row.scrollWidth <= row.clientWidth) return;
    const left = pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
    row.scrollTo({ left, behavior: reduceMotion ? "auto" : "smooth" });
  }, [active, reduceMotion]);

  return (
    <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-4">
      <Card className="p-1.5">
        <ul ref={list} className="relative flex gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:overflow-visible">
          {sections.map((section) => {
            const current = section.id === active;
            return (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${section.id}`}
                  aria-current={current ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(section.id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
                    window.history.replaceState(null, "", `#${section.id}`);
                  }}
                  className={`relative flex h-9 items-center whitespace-nowrap rounded-control px-3 text-sm font-medium pointer-coarse:h-11 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
                    current ? "text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {current ? <m.span layoutId="settings-nav-highlight" aria-hidden className="absolute inset-0 rounded-control bg-surface-2" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }} /> : null}
                  <span className="relative">{section.title}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </Card>
    </nav>
  );
}
