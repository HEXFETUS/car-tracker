import { Search, RotateCcw, Plus, Car, Users, Wrench } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export type TabKey = 'vehicles' | 'drivers' | 'maintenance';

interface ListToolbarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onNewItem: () => void;
  newItemLabel?: string;
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'vehicles', label: 'Vehicles', icon: <Car className="size-4" /> },
  { key: 'drivers', label: 'Drivers', icon: <Users className="size-4" /> },
  { key: 'maintenance', label: 'Maintenance', icon: <Wrench className="size-4" /> },
];

export function ListToolbar({
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  onNewItem,
  newItemLabel = 'New Item',
}: ListToolbarProps) {
  return (
    <div className="rounded-xl bg-white shadow-brand border border-zinc-100 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* ── Tabs ── */}
        <div className="flex items-center gap-0.5 shrink-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
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

        {/* ── Clear search ── */}
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
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search name, plate, code..."
              className="w-full h-10 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 focus:border-brand-teal transition-all"
            />
          </div>

           {/* New Item */}
          <button
            onClick={onNewItem}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-brand-teal px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
          >
            <Plus className="size-4" />
            <span>{newItemLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}