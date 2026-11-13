"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

/** Open state, highlighted row and keyboard handling for a select-style list (`aria-activedescendant`): arrows move,
    Enter or Space picks, Escape closes, and a typed letter jumps to the next option starting with it. */
export function useListbox<T>({
  items,
  value,
  valueOf,
  labelOf,
  onSelect,
}: {
  items: readonly T[];
  value: string;
  valueOf: (item: T) => string;
  labelOf: (item: T) => string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${baseId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, baseId]);

  const show = () => {
    setActive(Math.max(0, items.findIndex((item) => valueOf(item) === value)));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (item: T) => {
    onSelect(valueOf(item));
    close(true);
  };

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    const last = items.length - 1;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        close(false);
        return;
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(last, index + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      case "Home":
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        event.preventDefault();
        setActive(last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (items[active]) choose(items[active]);
        return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const starts = (index: number) => labelOf(items[index]).toLowerCase().startsWith(letter);
      const after = items.findIndex((_, index) => index > active && starts(index));
      const match = after >= 0 ? after : items.findIndex((_, index) => starts(index));
      if (match >= 0) setActive(match);
    }
  }

  return { open, active, setActive, rootRef, triggerRef, optionId, toggle: () => (open ? close(false) : show()), choose, onKeyDown };
}
