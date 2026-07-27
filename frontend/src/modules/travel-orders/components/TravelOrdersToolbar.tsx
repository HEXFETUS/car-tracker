import { Search, RotateCcw, RefreshCw, Plus, Clock, ClipboardCheck, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export type TabKey = 'pending' | 'for-approval' | 'approved' | 'cancelled';

interface TravelOrdersToolbarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  visibleTabs: { key: TabKey; label: string }[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onNewOrder: () => void;
  canCreate?: boolean;
  loading?: boolean;
}

const TAB_ICONS: Record<TabKey, React.ReactNode> = {
  pending: <Clock className="size-4" />,
  'for-approval': <ClipboardCheck className="size-4" />,
  approved: <CheckCircle className="size-4" />,
  cancelled: <XCircle className="size-4" />,
};

export function TravelOrdersToolbar({
  activeTab,
  onTabChange,
  visibleTabs,
  searchQuery,
  onSearchChange,
  onRefresh,
  onNewOrder,
  canCreate = true,
  loading = false,
}: TravelOrdersToolbarProps) {
  return (
    <div className="rounded-xl bg-white shadow-brand border border-zinc-100 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* ── Tabs ── */}
        <div className="flex w-full shrink-0 items-center gap-0.5 overflow-x-auto lg:w-auto">
          {visibleTabs.map((tab) => (
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
              {TAB_ICONS[tab.key]}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Clear filters ── */}
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="inline-flex items-center justify-center size-10 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
            title="Clear search"
          >
            <RotateCcw className="size-4" />
          </button>
        )}

        {/* ── Spacer ── */}
        <div className="hidden lg:block flex-1 min-w-0" />

        {/* ── Search + Actions ── */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:flex-nowrap lg:w-auto">
          <div className="relative w-full sm:w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search TO #, traveler, route..."
              className="w-full h-10 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 focus:border-brand-teal transition-all"
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 sm:h-10 sm:flex-none"
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          {canCreate && (
            <button
              onClick={onNewOrder}
              className="inline-flex h-11 flex-[3] items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97] sm:h-10 sm:flex-none"
            >
              <Plus className="size-4" />
              <span>New Travel Order</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
