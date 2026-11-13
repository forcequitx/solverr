import { Icon, isIconName } from "@/components/ui/icon";

/** Turns a docs page's `icon` frontmatter (an icon name from `components/ui/icon.tsx`) into its icon. */
export function docsIcon(name: string | undefined) {
  if (!name || !isIconName(name)) return undefined;
  return <Icon name={name} className="size-4 shrink-0" />;
}
