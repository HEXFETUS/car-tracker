// ── Shared Pagination Component ──────────────────────────────────────────────
//
// Reusable pagination component matching the design spec:
// Left: "Showing {start}-{end} of {total}"
// Right: « First, ‹ Back, page numbers (1 2 3 4 ... 25), Next ›, Last »

import { cn } from '@/shared/lib/utils';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function getPageRange(current: number, total: number): (number | 'ellipsis')[] {
  const range: (number | 'ellipsis')[] = [];
  const delta = 1; // Show up to 5 pages total (including edges): 1 + up to 3 + total

  let left = Math.max(2, current - delta);
  let right = Math.min(total - 1, current + delta);

  // Adjust if we're at the beginning or end to show up to 5 pages total
  if (current <= 3) {
    left = 2;
    right = Math.min(5, total - 1);
  } else if (current >= total - 2) {
    left = Math.max(2, total - 4);
    right = total - 1;
  }

  range.push(1); // Always show first page

  if (left > 2) {
    range.push('ellipsis');
  }

  for (let i = left; i <= right; i++) {
    range.push(i);
  }

  if (right < total - 1) {
    range.push('ellipsis');
  }

  if (total > 1) {
    range.push(total); // Always show last page
  }

  return range;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  className,
}: PaginationProps) {
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const pageRange = getPageRange(currentPage, totalPages);

  if (totalItems === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-col gap-2 border-t border-zinc-100 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between', className)}>
      {/* Left: Showing text */}
      <p className="text-center text-[11px] text-zinc-400 sm:text-left">
        Showing {start}–{end} of {totalItems}
      </p>

      {/* Right: Navigation controls */}
      <div className="flex w-full items-center justify-between gap-2 sm:hidden">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="min-h-11 rounded-lg border border-zinc-200 px-4 text-xs font-medium transition-colors hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ Previous
        </button>
        <span className="text-xs font-medium text-zinc-500">
          Page {currentPage} of {Math.max(1, totalPages)}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="min-h-11 rounded-lg border border-zinc-200 px-4 text-xs font-medium transition-colors hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next ›
        </button>
      </div>

      <div className="hidden items-center gap-1.5 sm:flex">
        {/* Back */}
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="h-7 rounded-md border border-zinc-200 px-2.5 text-xs hover:border-brand-teal hover:text-brand-teal transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-200 disabled:hover:text-zinc-600"
        >
          ‹ Back
        </button>

        {/* Page numbers */}
        {pageRange.map((page, idx) => {
          if (page === 'ellipsis') {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="h-7 w-7 flex items-center justify-center text-[11px] text-zinc-400"
              >
                ...
              </span>
            );
          }

          return (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={cn(
                'h-7 w-7 rounded-md border text-xs font-medium transition-colors',
                currentPage === page
                  ? 'border-brand-teal bg-brand-teal text-white'
                  : 'border-zinc-200 hover:border-brand-teal hover:text-brand-teal',
              )}
            >
              {page}
            </button>
          );
        })}

        {/* Next */}
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="h-7 rounded-md border border-zinc-200 px-2.5 text-xs hover:border-brand-teal hover:text-brand-teal transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-200 disabled:hover:text-zinc-600"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
