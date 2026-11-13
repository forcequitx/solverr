"use client";

import { useState } from "react";

/** The one-line reason under a failed action button; technical `details` (a wallet library's error) stay behind "Details".
    `tone="danger"` is for failures with no red button above them, such as a wallet picker. */
export function ActionError({ message, details, tone = "muted", className = "" }: { message: string | null; details?: string | null; tone?: "muted" | "danger"; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!message) return null;
  return (
    <div role="alert" className={`text-meta ${tone === "danger" ? "text-danger" : "text-muted"} ${className}`}>
      <p className="[overflow-wrap:anywhere]">
        {message}
        {details ? (
          <>
            {" "}
            <button type="button" aria-expanded={open} className="font-semibold text-accent-text hover:underline" onClick={() => setOpen(!open)}>
              {open ? "Hide details" : "Details"}
            </button>
          </>
        ) : null}
      </p>
      {details && open ? (
        <p className="mt-2 max-h-24 overflow-auto rounded-control border border-line bg-surface-2 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere] [scrollbar-width:none]">{details}</p>
      ) : null}
    </div>
  );
}
