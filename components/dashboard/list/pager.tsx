import { PAGER_BUTTON } from "@/components/dashboard/list/list-styles";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";

const MAX_SLOTS = 7;

/** Page indexes to show, at most seven slots, with `null` for a gap: 0 … 4 5 6 … 19. */
function pageSlots(page: number, pages: number): (number | null)[] {
  if (pages <= MAX_SLOTS) return Array.from({ length: pages }, (_, index) => index);
  if (page < 4) return [0, 1, 2, 3, 4, null, pages - 1];
  if (page > pages - 5) return [0, null, pages - 5, pages - 4, pages - 3, pages - 2, pages - 1];
  return [0, null, page - 1, page, page + 1, null, pages - 1];
}

/** Previous and Next buttons with numbered pages on wider screens and "Page 2 of 5" on phones. */
export function Pager({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <button type="button" className={PAGER_BUTTON} disabled={page === 0} onClick={() => onChange(page - 1)}>
        <Icon name="arrowLeft" className="size-4" />
        Previous
      </button>
      <p className="text-meta tabular-nums text-muted sm:hidden">
        Page {page + 1} of {pages}
      </p>
      <div className="hidden items-center gap-1 sm:flex">
        {pageSlots(page, pages).map((slot, index) =>
          slot === null ? (
            <span key={`gap-${index}`} aria-hidden className="grid size-9 place-items-center text-sm text-muted">
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              aria-label={`Page ${slot + 1}`}
              aria-current={slot === page ? "page" : undefined}
              onClick={() => onChange(slot)}
              className={`grid size-9 pointer-coarse:size-11 place-items-center rounded-control text-sm font-medium tabular-nums transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
                slot === page ? "border border-line bg-surface text-fg shadow-card" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {slot + 1}
            </button>
          ),
        )}
      </div>
      <button type="button" className={PAGER_BUTTON} disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>
        Next
        <Icon name="arrowRight" className="size-4" />
      </button>
    </nav>
  );
}
