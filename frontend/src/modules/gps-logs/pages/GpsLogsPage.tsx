// ── GPS Logs Parent Page ──────────────────────────────────────
//
// Parent container that manages tab switching between:
// Logs, Trip History, Reports, Alerts, Telemetry.

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { GpsLogsTabs, type TabKey } from '../components/GpsLogsTabs';
import { LogsPage } from './LogsPage';
import { TripHistoryPage } from './TripHistoryPage';
import { ReportsPage } from './ReportsPage';
import { AlertsPage } from './AlertsPage';
import { TelemetryPage } from './TelemetryPage';

export function GpsLogsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>('logs');

  // Sync tab from URL search params
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'logs' || tab === 'trip-history' || tab === 'reports' || tab === 'alerts' || tab === 'telemetry') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
  };

  return (
    <div className="space-y-6">
      <GpsLogsTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {activeTab === 'logs' && <LogsPage />}
      {activeTab === 'trip-history' && <TripHistoryPage />}
      {activeTab === 'reports' && <ReportsPage />}
      {activeTab === 'alerts' && <AlertsPage />}
      {activeTab === 'telemetry' && <TelemetryPage />}
    </div>
  );
}
