import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import type { VehicleMonthlySummary } from '@/modules/reports/types';
import { fetchMonthlyReport } from '@/modules/reports/api/reports-api';
import {
  FileText,
  MapPin,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
  TrendingUp,
  Loader2,
  Inbox,
} from 'lucide-react';

interface MonthlyReportPageProps {
  selectedMonth: number;
  selectedYear: number;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
}

export function MonthlyReportPage({
  selectedMonth,
  selectedYear,
}: MonthlyReportPageProps) {
  const [vehicleSummaries, setVehicleSummaries] = useState<VehicleMonthlySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = async (month: number, year: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMonthlyReport({ month, year });
      setVehicleSummaries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monthly report');
      setVehicleSummaries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport(selectedMonth, selectedYear);
  }, [selectedMonth, selectedYear]);

  const totalApprovedTOs = useMemo(() => vehicleSummaries.reduce((sum, v) => sum + v.totalApprovedTOs, 0), [vehicleSummaries]);
  const totalGpsTrips = useMemo(() => vehicleSummaries.reduce((sum, v) => sum + v.totalGpsTrips, 0), [vehicleSummaries]);
  const totalGpsDistanceKm = useMemo(() => vehicleSummaries.reduce((sum, v) => sum + v.totalGpsDistanceKm, 0), [vehicleSummaries]);
  const linkedTOs = useMemo(() => vehicleSummaries.reduce((sum, v) => sum + (v.linkedTrips ?? 0), 0), [vehicleSummaries]);
  const unauthorizedTripsFlagged = useMemo(() => vehicleSummaries.reduce((sum, v) => sum + v.unauthorizedTrips, 0), [vehicleSummaries]);
  const varianceIssues = useMemo(() => vehicleSummaries.filter(v => v.totalGpsTrips !== v.totalApprovedTOs).length, [vehicleSummaries]);
  const approvalRatePct = useMemo(() => {
    if (totalGpsTrips === 0) return 0;
    return (linkedTOs / totalGpsTrips) * 100;
  }, [vehicleSummaries, totalGpsTrips, linkedTOs]);
  const averageGpsTripDistanceKm = useMemo(() => {
    if (totalGpsTrips === 0) return 0;
    return totalGpsDistanceKm / totalGpsTrips;
  }, [vehicleSummaries, totalGpsTrips, totalGpsDistanceKm]);

  const statPills = [
    { label: 'Total Approved TOs', value: totalApprovedTOs, icon: <FileText className="size-3.5" /> },
    { label: 'GPS Trips', value: totalGpsTrips, icon: <MapPin className="size-3.5" /> },
    { label: 'Total Distance', value: `${(totalGpsDistanceKm / 1000).toFixed(1)}k km`, icon: <Gauge className="size-3.5" /> },
    { label: 'Linked TOs', value: totalGpsTrips, icon: <CheckCircle2 className="size-3.5" /> },
    { label: 'Unauthorized', value: unauthorizedTripsFlagged, icon: <XCircle className="size-3.5" /> },
    { label: 'Variance Issues', value: varianceIssues, icon: <AlertTriangle className="size-3.5" /> },
    { label: 'Approval Rate', value: `${approvalRatePct.toFixed(1)}%`, icon: <TrendingUp className="size-3.5" /> },
    { label: 'Avg Trip Dist.', value: `${averageGpsTripDistanceKm.toFixed(1)} km`, icon: <BarChart3 className="size-3.5" /> },
  ];


  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" />
          Loading...
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}

      {/* Compact Stats Pills */}
      <div className="flex flex-wrap gap-2">
        {statPills.map((pill) => (
          <span
            key={pill.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs shadow-sm"
          >
            <span className="text-brand-teal">{pill.icon}</span>
            <span className="text-zinc-500">{pill.label}: </span>
            <span className="font-semibold text-zinc-900">{pill.value}</span>
          </span>
        ))}
      </div>

      {/* Per-Vehicle Summary Table */}
      <div>
        <div className={cn(tableContainerClass, 'hidden md:block')}>
          <table className={tableClass}>
            <thead>
              <tr className={tableHeaderClass}>
                <th className={tableHeaderCellClass}>Vehicle Plate No.</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>Total GPS Trips</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>Total GPS Distance (km)</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>Total Approved TOs</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>Unauthorized Trips</th>
                <th className={tableHeaderCellClass}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {vehicleSummaries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center">
                      <Inbox className="size-8 text-zinc-300 mb-2" />
                      <p className="text-sm text-zinc-500">No data available for the selected month and year.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                vehicleSummaries.map((vs) => (
                  <tr key={vs.vehiclePlateNo} className={tableRowClass}>
                    <td className={tableCellClass}>{vs.vehiclePlateNo}</td>
                    <td className={cn(tableCellClass, 'text-right font-mono')}>{vs.totalGpsTrips}</td>
                    <td className={cn(tableCellClass, 'text-right font-mono')}>{vs.totalGpsDistanceKm.toFixed(1)}</td>
                    <td className={cn(tableCellClass, 'text-right font-mono')}>{vs.totalApprovedTOs}</td>
                    <td className={cn(tableCellClass, 'text-right')}>
                      {vs.unauthorizedTrips > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                          {vs.unauthorizedTrips}
                        </span>
                      ) : (
                        <span className="font-mono text-zinc-400">0</span>
                      )}
                    </td>
                    <td className={cn(tableCellClass, 'max-w-[220px]')}>{vs.remarks || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 md:hidden">
          {vehicleSummaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center">
              <Inbox className="mb-2 size-8 text-zinc-300" />
              <p className="text-sm text-zinc-500">No data available for the selected month and year.</p>
            </div>
          ) : vehicleSummaries.map((vs) => (
            <article key={vs.vehiclePlateNo} className="rounded-xl border border-zinc-100 bg-white p-4 shadow-brand">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</p>
                  <p className="font-mono text-base font-bold text-brand-teal">{vs.vehiclePlateNo}</p>
                </div>
                <span className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                  vs.unauthorizedTrips > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700',
                )}>
                  {vs.unauthorizedTrips} unauthorized
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-zinc-400">GPS trips</dt><dd className="font-semibold text-zinc-800">{vs.totalGpsTrips}</dd></div>
                <div><dt className="text-xs text-zinc-400">Distance</dt><dd className="font-semibold text-zinc-800">{vs.totalGpsDistanceKm.toFixed(1)} km</dd></div>
                <div><dt className="text-xs text-zinc-400">Approved TOs</dt><dd className="font-semibold text-zinc-800">{vs.totalApprovedTOs}</dd></div>
                <div><dt className="text-xs text-zinc-400">Remarks</dt><dd className="break-words text-zinc-700">{vs.remarks || '—'}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
