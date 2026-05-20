import { useState, useCallback } from 'react';

export interface PaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface UsePaginationStateResult extends PaginationState {
  goToPage: (page: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  setPageSize: (size: number) => void;
  reset: () => void;
}

/**
 * usePaginationState – Shared pagination-logic för admin-moduler
 * WCAG 2.1 AA kompatibel med navigation
 */
export const usePaginationState = (initialPageSize = 10, initialTotalItems = 0): UsePaginationStateResult => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const totalItems = initialTotalItems;

  const totalPages = Math.ceil(totalItems / pageSize);

  const goToPage = useCallback(
    (newPage: number) => {
      const validPage = Math.max(1, Math.min(newPage, totalPages || 1));
      setPage(validPage);
    },
    [totalPages],
  );

  const nextPage = useCallback(() => {
    if (page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [page, totalPages]);

  const previousPage = useCallback(() => {
    if (page > 1) {
      setPage((p) => p - 1);
    }
  }, [page]);

  const setPageSizeAndReset = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1); // Reset to page 1 when changing page size
  }, []);

  const reset = useCallback(() => {
    setPage(1);
    setPageSizeState(initialPageSize);
  }, [initialPageSize]);

  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    goToPage,
    nextPage,
    previousPage,
    setPageSize: setPageSizeAndReset,
    reset,
  };
};
