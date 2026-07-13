import { Search, RotateCcw, RefreshCw, FileSpreadsheet, BarChart3, CalendarDays, Download } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export type TabKey = 'reconciliation' | 'monthly' | 'yearly';

interface ReportsToolbarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  reportType: string;
  onReportTypeChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  onRefresh: () => void;
  onExport?: () => void;
  onGenerateReport?: () => void;
  loading?: boolean;
  showGenerate?: boolean;
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'reconciliation', label: 'Reconciliation', icon: <FileSpreadsheet className="size-4" /> },
  { key: 'monthly', label: 'Monthly Report', icon: <BarChart3 className="size-4" /> },
  { key: 'yearly', label: 'Yearly Report', icon: <CalendarDays className="size-4" /> },
];

const REPORT_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'Reconciliation', label: 'Reconciliation' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Yearly', label: 'Yearly' },
];

export function ReportsToolbar({
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  reportType,
  onReportTypeChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  onRefresh,
  onExport,
  onGenerateReport,
  loading = false,
  showGenerate = false,
}: ReportsToolbarProps) {
  return (
    <div className="rounded-xl bg-white shadow-brand border border-zinc-100 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* ── Tabs ── */}
        <div className="flex w-full shrink-0 items-center gap-0.5 overflow-x-auto lg:w-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors sm:min-h-0',
                activeTab === tab.key
                  ? 'bg-brand-teal/10 text-brand-teal'
                  : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Divider ── */}
        <div className="hidden sm:block w-px h-6 bg-zinc-200 shrink-0" />

        {/* ── Search ── */}
        <div className="relative w-full sm:w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search report name, type..."
            className="w-full h-10 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 focus:border-brand-teal transition-all"
          />
        </div>

        {/* ── Report Type Select ── */}
        <select
          value={reportType}
          onChange={(e) => onReportTypeChange(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30 sm:h-10 sm:w-[170px]"
        >
          {REPORT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* ── Date From ── */}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30 sm:h-10 sm:w-[145px] sm:flex-none"
        />

        {/* ── Date To ── */}
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30 sm:h-10 sm:w-[145px] sm:flex-none"
        />

        {/* ── Clear Search ── */}
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="inline-flex items-center justify-center size-10 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
            title="Clear search"
          >
            <RotateCcw className="size-4" />
          </button>
        )}

        {/* ── Spacer pushes actions right ── */}
        <div className="flex-1 min-w-0" />

        {/* ── Actions ── */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {showGenerate && onGenerateReport && (
            <button
              onClick={onGenerateReport}
              className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-brand-teal px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <FileSpreadsheet className="size-4" />
              <span>Generate Report</span>
            </button>
          )}

          {onExport && (
            <button
              onClick={onExport}
              className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
