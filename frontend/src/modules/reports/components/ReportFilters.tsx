import { Search, RotateCcw } from 'lucide-react';

interface ReportFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  reportType: string;
  onReportTypeChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
}

export function ReportFilters({
  searchQuery,
  onSearchChange,
  reportType,
  onReportTypeChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
}: ReportFiltersProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative w-full sm:w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search report name, type, vehicle..."
          className="w-full h-10 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 focus:border-brand-teal transition-all"
        />
      </div>

      {/* Report Type */}
      <select
        value={reportType}
        onChange={(e) => onReportTypeChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30 sm:h-10 sm:w-[170px]"
      >
        <option value="">All Types</option>
        <option value="Reconciliation">Reconciliation</option>
        <option value="Monthly">Monthly</option>
        <option value="Yearly">Yearly</option>
      </select>

      {/* Date From */}
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateFromChange(e.target.value)}
        className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30 sm:h-10 sm:w-[145px] sm:flex-none"
      />

      {/* Date To */}
      <input
        type="date"
        value={dateTo}
        onChange={(e) => onDateToChange(e.target.value)}
        className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30 sm:h-10 sm:w-[145px] sm:flex-none"
      />

      {/* Clear */}
      {searchQuery && (
        <button
          onClick={() => onSearchChange('')}
          className="inline-flex items-center justify-center size-10 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
          title="Clear search"
        >
          <RotateCcw className="size-4" />
        </button>
      )}
    </div>
  );
}
