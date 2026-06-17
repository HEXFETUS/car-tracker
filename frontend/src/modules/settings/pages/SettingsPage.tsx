import { useState, useRef } from 'react';
import { Plus, RefreshCw, Users, Cable } from 'lucide-react';
import { UsersPage, type UsersPageHandle } from '@/modules/settings/pages/UsersPage';
import { ConnectionPage, type ConnectionPageHandle } from '@/modules/settings/pages/ConnectionPage';

type ActiveTab = 'users' | 'connections';

const TABS: { key: ActiveTab; label: string; icon: typeof Users }[] = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'connections', label: 'Connections', icon: Cable },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('users');

  const usersRef = useRef<UsersPageHandle>(null);
  const connectionsRef = useRef<ConnectionPageHandle>(null);

  return (
    <div className="space-y-8">
      {/* Tab Bar + Action Buttons — matching RequestsPage design */}
      <div className="border-b border-zinc-200">
        <div className="flex items-center justify-between gap-4">
          <nav className="-mb-px flex gap-4 sm:gap-6 overflow-x-auto pb-px" aria-label="Settings tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`
                    inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors
                    ${activeTab === tab.key
                      ? 'border-brand-teal text-brand-teal'
                      : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
                    }
                  `}
                  aria-current={activeTab === tab.key ? 'page' : undefined}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Action buttons on the right side of the tab bar */}
          <div className="flex items-center gap-2 pb-px shrink-0">
            {activeTab === 'users' && (
              <button
                onClick={() => usersRef.current?.openCreateModal()}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-3 py-2 sm:px-4 sm:py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Add New User</span>
              </button>
            )}
            {activeTab === 'connections' && (
              <button
                onClick={() => connectionsRef.current?.refresh()}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-3 py-2 sm:px-4 sm:py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
              >
                <RefreshCw className="size-4" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab Content ─────────────────────────────────────── */}
      {activeTab === 'users' && <UsersPage ref={usersRef} />}
      {activeTab === 'connections' && <ConnectionPage ref={connectionsRef} />}
    </div>
  );
}