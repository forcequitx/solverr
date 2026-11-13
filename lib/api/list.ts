import { z } from "zod";
import { ApiError } from "@/lib/api/errors";

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  starting_after: z.string().min(1).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

/** The fields of a `starting_after` record that place it in newest-first order. */
export const CURSOR_SELECT = { id: true, createdAt: true } as const;

/** Prisma arguments for newest-first pagination; fetches one extra row to tell whether more exist. */
export function pageArgs(query: ListQuery) {
  return {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: query.limit + 1,
  };
}

/** Rows after the `starting_after` record by its position, so a record that no longer matches the filters never hides the next one.
    400 when that id is not one of the caller's records. */
export function afterCursor(cursor: { id: string; createdAt: Date } | null, query: ListQuery) {
  if (!query.starting_after) return {};
  if (!cursor) throw new ApiError(400, "invalid_request", "starting_after does not match one of your records.", "starting_after");
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

export function listResponse<T, R>(rows: T[], query: ListQuery, serialize: (row: T) => R) {
  return { object: "list" as const, data: rows.slice(0, query.limit).map(serialize), has_more: rows.length > query.limit };
}
