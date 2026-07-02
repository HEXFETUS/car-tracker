// Standardized table classes matching the Telemetry table design
// Used across all modules for visual consistency

export const tableContainerClass =
  'overflow-hidden rounded-xl border border-zinc-100 bg-white';

export const tableClass =
  'min-w-full border-collapse text-sm';

export const tableHeaderClass =
  'bg-brand-cream/80 text-xs font-semibold uppercase tracking-wide text-zinc-500';

export const tableHeaderCellClass =
  'px-4 py-2.5 text-left whitespace-nowrap';

export const tableRowClass =
  'border-b border-zinc-100 transition-colors odd:bg-white even:bg-brand-cream/20 hover:bg-brand-teal/5';

export const tableCellClass =
  'px-4 py-2 align-middle text-sm text-zinc-700';

export const tablePaginationClass =
  'flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-sm';

export const tablePaginationButtonClass =
  'h-8 rounded-lg border border-zinc-200 px-3 text-sm hover:border-brand-teal hover:text-brand-teal transition-colors';

export const tableEmptyCellClass =
  'px-4 py-10 text-center text-sm text-zinc-500';

// Compact badge/pill style
export const badgeClass =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium';

// Compact action button style
export const actionButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-brand-teal hover:text-brand-teal transition-colors';