// ── Settings Toolbar ────────────────────────────────────────────
//
// Compact toolbar with tabs matching the updated app design.
// Connection | Users

import { RefreshCw, Wifi, Users } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export type SettingsTabKey = 'connections' | 'users';

interface SettingsToolbarProps {
  activeTab: SettingsTabKey;
  onTabChange: (tab: SettingsTabKey) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: React.ReactNode;
}

const TABS: { key: SettingsTabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'users', label: 'Users', icon: <Users className="size-4" /> },
  { key: 'connections', label: 'Connection', icon: <Wifi className="size-4" /> },
];

export function SettingsToolbar({
  activeTab,
  onTabChange,
  onRefresh,
  refreshing,
  actions,
}: SettingsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-brand border border-zinc-100">
      {/* ── Tabs ── */}
      <div className="flex items-center gap-0.5 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors',
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

      {/* ── Spacer ── */}
      <div className="flex-1 min-w-0" />

      {/* ── Actions ── */}
      <div className="flex items-center gap-2">
        {actions}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/30 px-3 py-2 text-sm font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
}