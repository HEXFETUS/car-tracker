import { useState } from 'react';
import { FileSpreadsheet, BarChart3, CalendarDays, Calendar, Filter, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { ReconciliationPage } from '@/modules/reports/pages/ReconciliationPage';
import { MonthlyReportPage } from '@/modules/reports/pages/MonthlyReportPage';
import { YearlyReportPage } from '@/modules/reports/pages/YearlyReportPage';

export type TabKey = 'reconciliation' | 'monthly' | 'yearly';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'reconciliation', label: 'Reconciliation', icon: <FileSpreadsheet className="size-4" /> },
  { key: 'monthly', label: 'Monthly Report', icon: <BarChart3 className="size-4" /> },
  { key: 'yearly', label: 'Yearly Report', icon: <CalendarDays className="size-4" /> },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CURRENT_YEAR = new Date().getFullYear();

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('reconciliation');
  const [selectedMonth, setSelectedMonth] = useState('June');
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);

  // Reconciliation filter state
  const [reconStatusFilter, setReconStatusFilter] = useState('');

  return (
    <div className="space-y-3">
      {/* ── Tab Navigation + right-side controls per tab ── */}
      <div className="rounded-xl bg-white shadow-brand border border-zinc-100 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tabs on the left */}
          <div className="flex items-center gap-0.5 shrink-0 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
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

          {/* Spacer pushes controls to the right */}
          <div className="flex-1 min-w-0" />

          {/* ── Reconciliation: status filter + refresh (right side) ── */}
          {activeTab === 'reconciliation' && (
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-zinc-500" />
              <select
                value={reconStatusFilter}
                onChange={(e) => setReconStatusFilter(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
              >
                <option value="">All Statuses</option>
                <option value="Matched">Matched</option>
                <option value="Flagged">Flagged</option>
                <option value="NO GPS RECORD">No GPS Record</option>
                <option value="MISSING TO DISTANCE">Missing TO Distance</option>
              </select>
              <button
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="size-4" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          )}

          {/* ── Monthly: period filter (right side) ── */}
          {activeTab === 'monthly' && (
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-zinc-400 shrink-0" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── Yearly: year filter (right side) ── */}
          {activeTab === 'yearly' && (
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-zinc-400 shrink-0" />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Page content ── */}
      {activeTab === 'reconciliation' && <ReconciliationPage statusFilter={reconStatusFilter} onStatusFilterChange={setReconStatusFilter} />}
      {activeTab === 'monthly' && <MonthlyReportPage selectedMonth={MONTHS.indexOf(selectedMonth) + 1} selectedYear={selectedYear} onMonthChange={(month) => setSelectedMonth(MONTHS[month - 1])} onYearChange={setSelectedYear} />}
      {activeTab === 'yearly' && <YearlyReportPage selectedYear={selectedYear} />}
    </div>
  );
}