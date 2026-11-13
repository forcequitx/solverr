"use client";

import { ErrorScreen } from "@/components/ui/error-screen";
import { ThemeScript } from "@/components/ui/theme-script";
import { FONT_VARIABLES } from "./fonts";
import "./globals.css";

/** Replaces the root layout when it fails, so it brings its own document, styles, fonts and saved theme. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    /** The theme script may set data-theme on <html> before React hydrates. */
    <html lang="en" className={FONT_VARIABLES} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <ThemeScript />
        <title>Something went wrong · Solverr</title>
        <ErrorScreen
          fullPage
          title="Something went wrong"
          message="Solverr ran into a problem and could not show this page. Try again, or go back to the home page."
          error={error}
          onRetry={retry}
          link={{ href: "/", label: "Go to the home page" }}
        />
      </body>
    </html>
  );
}
