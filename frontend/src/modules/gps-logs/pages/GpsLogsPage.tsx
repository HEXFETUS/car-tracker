// ── GPS Logs Parent Page ──────────────────────────────────────
//
// Parent container that manages tab switching between:
// Logs, Trip History, Reports, Alerts, Telemetry.
// Shared filter state is lifted here so switching tabs preserves filters.

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { type TabKey } from '../components/GpsLogsToolbar';
import { LogsPage } from './LogsPage';
import { TelemetryPage } from './TelemetryPage';

export function GpsLogsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>('logs');

  // ── Shared filter state (preserved across tab switches) ──
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  // Sync tab from URL search params
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'logs' || tab === 'telemetry') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
  };

  return (
    <div className="space-y-3">
      {activeTab === 'logs' && (
        <LogsPage
          activeTab={activeTab}
          onTabChange={handleTabChange}
          vehicleFilter={vehicleFilter}
          onVehicleFilterChange={setVehicleFilter}
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
        />
      )}
      {activeTab === 'telemetry' && (
        <TelemetryPage
          activeTab={activeTab}
          onTabChange={handleTabChange}
          vehicleFilter={vehicleFilter}
          onVehicleFilterChange={setVehicleFilter}
        />
      )}
    </div>
  );
}