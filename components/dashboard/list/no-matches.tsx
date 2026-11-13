/** Centered sentence shown in place of list items when a search or filter matches nothing; `li` inside a list. */
export function NoMatches({ as: Tag = "p", children }: { as?: "p" | "li"; children: string }) {
  return <Tag className="grid flex-1 place-items-center px-6 py-16 text-center text-sm text-muted">{children}</Tag>;
}
