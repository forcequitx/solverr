"use client";

import { useState } from "react";

/** Rows per page in the dashboard's card lists. */
export const PAGE_SIZE = 8;

/** Splits `items` into pages; the page index is clamped when filtering leaves fewer pages. */
export function usePages<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  /** Wraps a filter's setter so that changing the filter also goes back to the first page. */
  const filterBy =
    <V,>(set: (value: V) => void) =>
    (value: V) => {
      set(value);
      setPage(0);
    };
  return { page: current, pages, visible: items.slice(current * pageSize, (current + 1) * pageSize), setPage, filterBy };
}
