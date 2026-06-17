import { useState } from 'react';
import { Users, Cable } from 'lucide-react';
import { UsersPage } from '@/modules/settings/pages/UsersPage';
import { ConnectionPage } from '@/modules/settings/pages/ConnectionPage';

type ActiveTab = 'users' | 'connections';

const TABS: { key: ActiveTab; label: string; icon: typeof Users }[] = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'connections', label: 'Connections', icon: Cable },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('users');

  return (
    <div className="space-y-8">
      {/* Tab Bar — matching RequestsPage design */}
      <div className="border-b border-zinc-200">
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
      </div>

      {/* ── Tab Content ─────────────────────────────────────── */}
      {activeTab === 'users' && <UsersPage />}
      {activeTab === 'connections' && <ConnectionPage />}
    </div>
  );
}