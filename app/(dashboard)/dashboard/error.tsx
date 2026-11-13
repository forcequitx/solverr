"use client";

import { ErrorScreen } from "@/components/ui/error-screen";

/** Shown inside the dashboard shell when a dashboard page fails to load. */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorScreen
      title="This page did not load"
      message="The server did not return this page. Try again, or go back to the dashboard."
      error={error}
      onRetry={retry}
      link={{ href: "/dashboard", label: "Go to the dashboard" }}
    />
  );
}
