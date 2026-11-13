import type { ReactNode } from "react";
import { HeaderControls } from "@/components/dashboard/header-controls";

/** Page header card: title and description, with the inbox and the page's main action. */
export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 rounded-card border border-line bg-surface px-5 py-4 shadow-card sm:px-6 sm:py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[28px]">{title}</h1>
          {description ? <div className="mt-0.5 max-w-2xl text-sm font-medium text-muted">{description}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HeaderControls />
          {action}
        </div>
      </div>
    </div>
  );
}
