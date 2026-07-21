import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './pagination.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
}

/**
 * Pagination – WCAG 2.1 AA kompatibel pagination-kontroll
 * Visar sida-nummer och navigerings-knappar
 */
export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onPreviousPage,
  onNextPage,
  onGoToPage,
}) => {
  // Generate page numbers to display (e.g., 1 2 3 4 5)
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    const halfVisible = Math.floor(maxVisible / 2);

    let start = Math.max(1, page - halfVisible);
    const adjustedEnd = Math.min(totalPages, start + maxVisible - 1);

    if (adjustedEnd - start + 1 < maxVisible) {
      start = Math.max(1, adjustedEnd - maxVisible + 1);
    }

    const finalEnd = Math.min(totalPages, start + maxVisible - 1);

    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('...');
    }

    for (let i = start; i <= finalEnd; i++) {
      pages.push(i);
    }

    if (finalEnd < totalPages) {
      if (finalEnd < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <nav className="pagination" role="navigation" aria-label="Sidnavigation">
      <div className="pagination-container">
        {/* Previous button */}
        <button
          className="pagination-btn pagination-btn-prev"
          onClick={onPreviousPage}
          disabled={!hasPreviousPage}
          aria-label="Föregående sida"
          title={hasPreviousPage ? 'Gå till föregående sida' : 'Du är på första sidan'}
        >
          <ChevronLeft size={18} />
          <span>Föregående</span>
        </button>

        {/* Page numbers */}
        <div className="pagination-numbers">
          {getPageNumbers().map((pageNum, idx) => {
            if (pageNum === '...') {
              return (
                <span key={`ellipsis-${idx}`} className="pagination-ellipsis">
                  ...
                </span>
              );
            }

            const isCurrentPage = pageNum === page;
            return (
              <button
                key={pageNum}
                className={`pagination-number ${isCurrentPage ? 'active' : ''}`}
                onClick={() => onGoToPage(pageNum as number)}
                aria-current={isCurrentPage ? 'page' : undefined}
                aria-label={`Gå till sida ${pageNum}`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        {/* Next button */}
        <button
          className="pagination-btn pagination-btn-next"
          onClick={onNextPage}
          disabled={!hasNextPage}
          aria-label="Nästa sida"
          title={hasNextPage ? 'Gå till nästa sida' : 'Du är på sista sidan'}
        >
          <span>Nästa</span>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Page info */}
      <p className="pagination-info" aria-live="polite">
        Sida <strong>{page}</strong> av <strong>{totalPages}</strong>
      </p>
    </nav>
  );
};

export default Pagination;
