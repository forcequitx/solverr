"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";

const layer = (shown: boolean) => `col-start-1 row-start-1 inline-flex items-center justify-center gap-2 transition-opacity duration-150 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`;

/** Button that shows its own outcome at a fixed width: spinner (`pendingLabel`) while `pending`, green check (`doneLabel`) while `done`,
    red retry (`failedLabel`) while `failed`; the failure reason goes in an `ActionError` under it. */
export function ActionButton({
  pending = false,
  pendingLabel,
  done,
  doneLabel = "Saved",
  failed,
  failedLabel = "Try again",
  disabled,
  variant,
  children,
  ...props
}: ComponentProps<typeof Button> & { pending?: boolean; pendingLabel?: ReactNode; done?: boolean; doneLabel?: ReactNode; failed?: boolean; failedLabel?: ReactNode }) {
  const announced = pending && pendingLabel !== undefined;
  const showDone = Boolean(done) && !pending;
  const showFailed = Boolean(failed) && !pending && !showDone;
  const outcome = showDone ? "succeeded" : showFailed ? "failed" : variant;
  return (
    <Button disabled={disabled || pending} aria-busy={pending || undefined} variant={outcome} {...props}>
      <span className="grid">
        <span aria-hidden={showDone || showFailed || announced || undefined} className={layer(!pending && !showDone && !showFailed)}>
          {children}
        </span>
        <span aria-hidden={!announced || undefined} className={layer(pending)}>
          <Spinner />
          {pendingLabel}
        </span>
        {done === undefined ? null : (
          <span aria-hidden={!showDone || undefined} className={layer(showDone)}>
            <Icon name="check" className="size-4" />
            {doneLabel}
          </span>
        )}
        {failed === undefined ? null : (
          <span aria-hidden={!showFailed || undefined} className={layer(showFailed)}>
            <Icon name="retry" className="size-4" />
            {failedLabel}
          </span>
        )}
      </span>
    </Button>
  );
}
