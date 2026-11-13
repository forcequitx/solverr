"use client";

import { useLayoutEffect } from "react";
import { applySavedTheme, THEME_INIT_SCRIPT } from "@/components/ui/theme";

/** Applies the saved light or dark choice while the server HTML is parsed, before the first paint. In the browser the tag is `text/plain`
    (no script-tag warning on a client render such as not-found); the layout effect re-applies it, as a client render rebuilds <html>. */
export function ThemeScript() {
  useLayoutEffect(applySavedTheme, []);
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
