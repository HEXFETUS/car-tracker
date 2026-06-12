import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  MOCK_MONTHLY_KPI,
  MOCK_VEHICLE_SUMMARIES,
} from '@/modules/reports/mock-data';
import type { MonthlyKpi, VehicleMonthlySummary } from '@/modules/reports/types';
import {
  Calendar,
  FileText,
  MapPin,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
  TrendingUp,
  Car,
} from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CURRENT_YEAR = 2026;

interface KpiCardDef {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: boolean;
}

function KpiCard({ label, value, icon, accent }: KpiCardDef) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg',
        accent && 'ring-1 ring-brand-teal/20'
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
            {typeof value === 'number' && label.includes('Rate')
              ? `${value.toFixed(1)}%`
              : typeof value === 'number' && label.includes('Distance')
              ? `${value.toLocaleString()}`
              : value}
          </p>
        </div>
        <div className="rounded-lg bg-brand-moss/30 p-2.5 text-brand-teal">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function MonthlyReportPage() {
  const [selectedMonth, setSelectedMonth] = useState('June');
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);

  const kpi: MonthlyKpi = MOCK_MONTHLY_KPI;
  const vehicleSummaries: VehicleMonthlySummary[] = MOCK_VEHICLE_SUMMARIES;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
          Monthly Summary Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Key performance indicators and vehicle breakdown for the selected period
        </p>
      </div>

      {/* Month / Year Filter */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white p-4 shadow-brand">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-700">Period:</span>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="rounded-lg border border-brand-sage/30 bg-brand-cream/50 px-3 py-1.5 text-sm font-medium text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
        >
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="rounded-lg border border-brand-sage/30 bg-brand-cream/50 px-3 py-1.5 text-sm font-medium text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
        >
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-400">
          Showing data for {selectedMonth} {selectedYear}
        </span>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Approved TOs"
          value={kpi.totalApprovedTOs}
          icon={<FileText className="size-5" />}
          accent
        />
        <KpiCard
          label="Total GPS Trips Recorded"
          value={kpi.totalGpsTripsRecorded}
          icon={<MapPin className="size-5" />}
        />
        <KpiCard
          label="Total GPS Distance"
          value={`${kpi.totalGpsDistanceKm.toLocaleString()} km`}
          icon={<Gauge className="size-5" />}
        />
        <KpiCard
          label="Trips With Linked TO"
          value={kpi.tripsWithLinkedTO}
          icon={<CheckCircle2 className="size-5" />}
        />
        <KpiCard
          label="Unauthorized Trips Flagged"
          value={kpi.unauthorizedTripsFlagged}
          icon={<XCircle className="size-5" />}
          accent
        />
        <KpiCard
          label="Variance Exceedances"
          value={kpi.varianceExceedances}
          icon={<AlertTriangle className="size-5" />}
          accent
        />
        <KpiCard
          label="TO Approval Rate"
          value={`${kpi.toApprovalRatePct.toFixed(1)}%`}
          icon={<TrendingUp className="size-5" />}
        />
        <KpiCard
          label="Avg GPS Trip Distance"
          value={`${kpi.averageGpsTripDistanceKm.toFixed(1)} km`}
          icon={<BarChart3 className="size-5" />}
        />
      </div>

      {/* Per-Vehicle Summary Table */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">
          Per-Vehicle Summary
        </h2>
        <div className="hidden overflow-hidden rounded-xl bg-white shadow-brand md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-cream text-left text-xs font-medium uppercase tracking-wider text-brand-teal">
                  <th className="whitespace-nowrap px-5 py-4">Vehicle Plate No.</th>
                  <th className="whitespace-nowrap px-5 py-4 text-right">Total GPS Trips</th>
                  <th className="whitespace-nowrap px-5 py-4 text-right">Total GPS Distance (km)</th>
                  <th className="whitespace-nowrap px-5 py-4 text-right">Total Approved TOs</th>
                  <th className="whitespace-nowrap px-5 py-4 text-right">Unauthorized Trips</th>
                  <th className="whitespace-nowrap px-5 py-4">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {vehicleSummaries.map((vs, idx) => (
                  <tr
                    key={vs.vehiclePlateNo}
                    className={cn(
                      'transition-colors',
                      idx % 2 === 0 ? 'bg-white' : 'bg-brand-cream/50',
                      'hover:bg-brand-moss/20'
                    )}
                  >
                    <td className="whitespace-nowrap px-5 py-4 font-medium text-zinc-900">
                      {vs.vehiclePlateNo}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-mono text-zinc-900">
                      {vs.totalGpsTrips}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-mono text-zinc-900">
                      {vs.totalGpsDistanceKm.toFixed(1)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-mono text-zinc-900">
                      {vs.totalApprovedTOs}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right">
                      {vs.unauthorizedTrips > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                          {vs.unauthorizedTrips}
                        </span>
                      ) : (
                        <span className="font-mono text-zinc-400">0</span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-5 py-4 text-zinc-400">
                      {vs.remarks || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile vehicle cards */}
        <div className="space-y-3 md:hidden">
          {vehicleSummaries.map((vs) => (
            <div key={vs.vehiclePlateNo} className="rounded-xl bg-white p-4 shadow-brand">
              <div className="mb-2 flex items-center gap-2">
                <div className="rounded-lg bg-brand-moss/30 p-1.5 text-brand-teal">
                  <Car className="size-4" />
                </div>
                <p className="text-sm font-semibold text-zinc-900">{vs.vehiclePlateNo}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-zinc-400">GPS Trips</p>
                  <p className="font-medium text-zinc-800">{vs.totalGpsTrips}</p>
                </div>
                <div>
                  <p className="text-zinc-400">GPS Distance</p>
                  <p className="font-medium text-zinc-800">{vs.totalGpsDistanceKm.toFixed(1)} km</p>
                </div>
                <div>
                  <p className="text-zinc-400">Approved TOs</p>
                  <p className="font-medium text-zinc-800">{vs.totalApprovedTOs}</p>
                </div>
                <div>
                  <p className="text-zinc-400">Unauthorized</p>
                  <p className={cn('font-medium', vs.unauthorizedTrips > 0 ? 'text-red-600' : 'text-zinc-800')}>
                    {vs.unauthorizedTrips}
                  </p>
                </div>
              </div>
              {vs.remarks && (
                <p className="mt-2 rounded-lg bg-brand-cream px-3 py-1.5 text-xs text-zinc-500">
                  {vs.remarks}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}