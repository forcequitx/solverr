"use client";

import { CopyAction } from "@/components/dashboard/copy-buttons";
import { Icon } from "@/components/ui/icon";

/** Shows a secret exactly once with a copy button and a warning that it cannot be shown again. */
export function SecretReveal({ label, secret }: { label: string; secret: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-accent/40 bg-accent/10 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="eye" className="size-4 text-accent-text" />
        {label}
      </p>
      <p className="select-all break-all rounded-control border border-line bg-surface px-3 py-2.5 font-mono text-meta">{secret}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-meta text-muted">Copy it now. Solverr cannot show it again.</span>
        <CopyAction text={secret} variant="secondary" size="sm">
          <Icon name="copy" className="size-4" />
          Copy
        </CopyAction>
      </div>
    </div>
  );
}
