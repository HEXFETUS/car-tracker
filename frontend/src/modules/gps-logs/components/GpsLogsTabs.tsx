// ── GPS Logs Tab Navigation ────────────────────────────────────
//
// Reusable tab navigation for the GPS Logs module.
// Each tab maps to its own page component.

import { History, Gauge } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export type TabKey = 'logs' | 'telemetry';

interface GpsLogsTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'logs', label: 'Logs', icon: <History className="size-4" /> },
  { key: 'telemetry', label: 'Telemetry', icon: <Gauge className="size-4" /> },
];

export function GpsLogsTabs({ activeTab, onTabChange }: GpsLogsTabsProps) {
  return (
    <div className="flex items-center gap-1 border-b border-zinc-200">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === tab.key
              ? 'border-brand-teal text-brand-teal'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-200',
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
