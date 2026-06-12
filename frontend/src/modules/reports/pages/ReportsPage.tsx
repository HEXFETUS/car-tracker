import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
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
      {/* Tab navigation */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-1.5 shadow-brand">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand-teal text-white shadow-sm'
                  : 'text-zinc-500 hover:bg-brand-cream hover:text-brand-teal'
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Page content */}
      {activeTab === 'reconciliation' && <ReconciliationPage />}
      {activeTab === 'monthly' && <MonthlyReportPage />}
      {activeTab === 'yearly' && <YearlyReportPage />}
    </div>
  );
}