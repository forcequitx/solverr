import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import type { IconName } from "@/components/ui/icon";
import type { Tint } from "@/components/ui/icon-box";

/** Card with the dashboard section header and its content; with `id` it is a page section, labelled by its title, that in-page links scroll to
    (below the pinned phone top bar). */
export function SectionCard({
  id,
  icon,
  tint = "lime",
  title,
  description,
  action,
  className = "",
  children,
}: {
  id?: string;
  icon: IconName;
  tint?: Tint;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={titleId} className={`min-w-0 scroll-mt-24 md:scroll-mt-4 ${className}`}>
      <Card className="flex h-full min-w-0 flex-col gap-5 p-5 sm:p-6">
        <CardHeading icon={icon} tint={tint} title={title} titleId={titleId} description={description} aside={action} />
        {children}
      </Card>
    </section>
  );
}
