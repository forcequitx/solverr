import type { ReactNode } from "react";
import type { IconName } from "@/components/ui/icon";
import { IconBox, type Tint } from "@/components/ui/icon-box";

/** Card header: tinted icon, title and one-line description, with an optional count, status or action on the right. */
export function CardHeading({
  icon,
  tint,
  title,
  titleId,
  description,
  aside,
}: {
  icon: IconName;
  tint?: Tint;
  title: string;
  titleId?: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-[min(100%,15rem)] flex-1 items-start gap-3">
        <IconBox name={icon} tint={tint} />
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? <p className="text-meta text-muted">{description}</p> : null}
        </div>
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}
