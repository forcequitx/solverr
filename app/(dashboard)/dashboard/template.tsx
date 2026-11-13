import type { ReactNode } from "react";

/** Re-mounts on every dashboard navigation, so each page fades up into place. The animation keeps no end state, so the wrapper
    is left without a transform and fixed panels inside a page (the phone inbox sheet) are placed against the screen. */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page-in [animation-fill-mode:backwards]">{children}</div>;
}
