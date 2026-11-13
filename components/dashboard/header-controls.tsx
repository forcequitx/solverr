"use client";

import { useDashboard } from "@/components/dashboard/dashboard-context";
import { NotificationInbox } from "@/components/dashboard/notification-inbox";

/** Notification inbox for the page header. */
export function HeaderControls() {
  return <NotificationInbox alerts={useDashboard().alerts} />;
}
