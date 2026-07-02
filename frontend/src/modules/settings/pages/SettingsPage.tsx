// ── Settings Page ──────────────────────────────────────────────
//
// Modern settings layout with compact toolbar and tab content.

import { useState, useRef, useCallback } from 'react';
import { UserPlus } from 'lucide-react';
import { UsersPage, type UsersPageHandle } from '@/modules/settings/pages/UsersPage';
import { ConnectionPage, type ConnectionPageHandle } from '@/modules/settings/pages/ConnectionPage';
import { SettingsToolbar, type SettingsTabKey } from '../components/SettingsToolbar';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('users');
  const [refreshing, setRefreshing] = useState(false);

  const usersRef = useRef<UsersPageHandle>(null);
  const connectionsRef = useRef<ConnectionPageHandle>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'connections') {
      connectionsRef.current?.refresh();
    }
    setTimeout(() => setRefreshing(false), 500);
  }, [activeTab]);

  const handleAddUser = useCallback(() => {
    usersRef.current?.openCreateModal();
  }, []);

  return (
    <div className="space-y-3">
      {/* Compact toolbar with Add New User in the actions area */}
      <SettingsToolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          activeTab === 'users' ? (
            <button
              onClick={handleAddUser}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80"
            >
              <UserPlus className="size-4" />
              <span className="hidden sm:inline">Add New User</span>
            </button>
          ) : undefined
        }
      />

      {/* ── Tab Content ─────────────────────────────────────── */}
      {activeTab === 'users' && <UsersPage ref={usersRef} />}
      {activeTab === 'connections' && <ConnectionPage ref={connectionsRef} />}
    </div>
  );
}