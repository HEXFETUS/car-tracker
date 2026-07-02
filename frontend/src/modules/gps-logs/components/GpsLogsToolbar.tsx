// ── GPS Logs Unified Toolbar ──────────────────────────────────
//
// Combines tabs, filters, and action buttons into a single toolbar row.
// Tabs on the left, filters in the middle, actions on the right.
// Wraps gracefully on smaller screens.

import { History, Gauge, Search, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export type TabKey = 'logs' | 'telemetry';

interface GpsLogsToolbarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  /** Filter controls rendered between tabs and action buttons */
  filters?: React.ReactNode;
  /** Action buttons rendered on the far right */
  actions?: React.ReactNode;
  /** Show search & reset in the toolbar (otherwise rendered inside filters) */
  onSearch?: () => void;
  onReset?: () => void;
  /** If true, renders a small card around the whole toolbar */
  variant?: 'card' | 'simple';
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'logs', label: 'Logs', icon: <History className="size-4" /> },
  { key: 'telemetry', label: 'Telemetry', icon: <Gauge className="size-4" /> },
];

export function GpsLogsToolbar({
  activeTab,
  onTabChange,
  filters,
  actions,
  onSearch,
  onReset,
  variant = 'card',
}: GpsLogsToolbarProps) {
  const content = (
    <div className="flex items-center gap-3 flex-wrap">
      {/* ── Tabs ── */}
      <div className="flex items-center gap-0.5 shrink-0">
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

      {/* ── Divider ── */}
      <div className="hidden sm:block w-px h-6 bg-zinc-200 shrink-0" />

      {/* ── Filters ── */}
      {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}

      {/* ── Search / Reset ── */}
      {(onSearch || onReset) && (
        <div className="flex items-center gap-1">
          {onSearch && (
            <button
              onClick={onSearch}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/30 px-3 py-2 text-sm font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
            >
              <Search className="size-4" />
              <span className="hidden sm:inline">Search</span>
            </button>
          )}
          {onReset && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              <RotateCcw className="size-4" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>
      )}

      {/* ── Spacer pushes actions right ── */}
      {actions && <div className="flex-1 min-w-0" />}

      {/* ── Actions ── */}
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="rounded-xl bg-white border border-zinc-100 px-4 py-3">
        {content}
      </div>
    );
  }

  return content;
}