import { FOCUS_RING } from "@/components/ui/focus-ring";

/** Height of an empty list's message: the same in every card, sized for the message rather than a page of rows. */
export const EMPTY_LIST_HEIGHT = "min-h-[220px]";

/** A list's full-page `height` only when it has more than one page, so paging never resizes the card and a one-page list fits its rows. */
export const pageHeight = (rows: number, pageSize: number, height: string): string => (rows > pageSize ? height : "");

/** Table body of a list card: a rule under each row, with the first and last cells lined up with the card's padding. */
export const LIST_TBODY = "[&_td]:border-b [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6";

/** Previous and Next buttons of a list's pages. */
export const PAGER_BUTTON = `inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-sm font-medium transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none ${FOCUS_RING}`;

/** Square icon button for row actions such as open and copy. */
export const ICON_ACTION = `relative grid size-8 shrink-0 pointer-coarse:size-11 place-items-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-fg motion-reduce:transition-none ${FOCUS_RING}`;
