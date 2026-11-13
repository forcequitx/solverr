"use client";

import { ErrorScreen } from "@/components/ui/error-screen";

/** Shown inside the root layout when a page outside the dashboard, checkout and receipt fails, such as help or the docs. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorScreen
      fullPage
      title="Something went wrong"
      message="Solverr ran into a problem and could not show this page. Try again, or go back to the home page."
      error={error}
      onRetry={retry}
      link={{ href: "/", label: "Go to the home page" }}
    />
  );
}
