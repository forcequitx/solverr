"use client";

import { MotionConfig } from "motion/react";
import { createContext, useContext, type ReactNode } from "react";

export type InboxAlert = { id: string; kind: string; message: string; createdAt: string; read: boolean };

/** `merchantId` is the business the layout was rendered for; every dashboard action sends it, so a tab left on another business is refused. */
type DashboardInfo = { merchantId: string; alerts: InboxAlert[] };

const DashboardContext = createContext<DashboardInfo | null>(null);

/** Shares layout data (business, alerts) with the pages inside; Motion animations follow the system's reduced-motion setting. */
export function DashboardProvider({ value, children }: { value: DashboardInfo; children: ReactNode }) {
  return (
    <DashboardContext value={value}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </DashboardContext>
  );
}

/** The layout data; every dashboard page renders inside `DashboardProvider`. */
export function useDashboard(): DashboardInfo {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard needs the dashboard layout's DashboardProvider.");
  return value;
}

/** The id of the business this tab shows, for dashboard server actions and links that act on it. */
export function useMerchantId(): string {
  return useDashboard().merchantId;
}
