import { useState } from 'react';
import { ReconciliationPage } from '@/modules/reports/pages/ReconciliationPage';
import { MonthlyReportPage } from '@/modules/reports/pages/MonthlyReportPage';
import { YearlyReportPage } from '@/modules/reports/pages/YearlyReportPage';
import { FileSpreadsheet, BarChart3, CalendarDays } from 'lucide-react';

const TABS = [
  { key: 'reconciliation', label: 'Reconciliation', icon: FileSpreadsheet },
  { key: 'monthly', label: 'Monthly Report', icon: BarChart3 },
  { key: 'yearly', label: 'Yearly Report', icon: CalendarDays },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('reconciliation');

  return (
    <div className="space-y-8">
      {/* Tab navigation — scrollable on mobile */}
      <div className="border-b border-zinc-200">
        <nav className="-mb-px flex gap-4 sm:gap-6 overflow-x-auto pb-px" aria-label="Reports tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors
                ${
                  activeTab === tab.key
                    ? 'border-brand-teal text-brand-teal'
                    : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
                }
              `}
              aria-current={activeTab === tab.key ? 'page' : undefined}
            >
              <tab.icon className="inline size-4 mr-1.5 -mt-0.5" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Page content */}
      {activeTab === 'reconciliation' && <ReconciliationPage />}
      {activeTab === 'monthly' && <MonthlyReportPage />}
      {activeTab === 'yearly' && <YearlyReportPage />}
    </div>
  );
}