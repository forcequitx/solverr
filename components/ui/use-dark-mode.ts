"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/components/ui/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : window.matchMedia(DARK_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

/** Whether dark mode is on, and a toggle that saves the choice in this browser so it applies before the next page paints. */
export function useDarkMode(): [dark: boolean, toggle: () => void] {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /** Storage can be blocked; the choice then lasts for this page only. */
    }
  };
  return [dark, toggle];
}
