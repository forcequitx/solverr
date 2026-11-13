import { Icon, type IconName } from "@/components/ui/icon";
import { initials } from "@/lib/format";

export type Tint = "lime" | "blue";

export const TINTS: Record<Tint, string> = {
  lime: "bg-success-bg text-success",
  blue: "bg-accent/15 text-accent-tint-text",
};

const AVATAR_SIZES = { sm: "size-8 text-xs", md: "size-9 text-xs" };

/** Tinted square holding a card's icon. */
export function IconBox({ name, tint = "lime" }: { name: IconName; tint?: Tint }) {
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-control ${TINTS[tint]}`}>
      <Icon name={name} className="size-[18px]" />
    </span>
  );
}

/** Round tinted avatar with the initials of `text`, or `icon` in their place; down a list, `index` alternates the tint from `firstTint`. */
export function InitialsAvatar({
  index = 0,
  firstTint = "lime",
  size = "md",
  ...content
}: ({ text: string; icon?: never } | { icon: IconName; text?: never }) & { index?: number; firstTint?: Tint; size?: keyof typeof AVATAR_SIZES }) {
  const tint = index % 2 === 0 ? firstTint : firstTint === "lime" ? "blue" : "lime";
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${AVATAR_SIZES[size]} ${TINTS[tint]}`}>
      {content.icon ? <Icon name={content.icon} className="size-4" /> : initials(content.text)}
    </span>
  );
}
