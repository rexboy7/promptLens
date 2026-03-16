import { useMemo } from "react";

export type PaginationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; key: string };

export function usePagination(currentPage: number, totalPages: number) {
  return useMemo<PaginationItem[]>(() => {
    if (totalPages <= 0) return [];

    const clampedCurrent = Math.max(0, Math.min(currentPage, totalPages - 1));
    const pages = new Set<number>([
      0,
      totalPages - 1,
      clampedCurrent - 1,
      clampedCurrent,
      clampedCurrent + 1,
    ]);
    const sorted = [...pages]
      .filter((page) => page >= 0 && page < totalPages)
      .sort((a, b) => a - b);

    const items: PaginationItem[] = [];
    let prevPage: number | null = null;
    for (const page of sorted) {
      if (prevPage !== null) {
        const gap = page - prevPage;
        if (gap === 2) {
          items.push({ type: "page", page: prevPage + 1 });
        } else if (gap > 2) {
          items.push({ type: "ellipsis", key: `ellipsis-${prevPage}-${page}` });
        }
      }
      items.push({ type: "page", page });
      prevPage = page;
    }
    return items;
  }, [currentPage, totalPages]);
}
