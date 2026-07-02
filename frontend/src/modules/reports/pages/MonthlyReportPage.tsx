import { cn } from '@/shared/lib/utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import {
  MOCK_MONTHLY_KPI,
  MOCK_VEHICLE_SUMMARIES,
} from '@/modules/reports/mock-data';
import type { MonthlyKpi, VehicleMonthlySummary } from '@/modules/reports/types';
import {
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

export function MonthlyReportPage() {
  const kpi: MonthlyKpi = MOCK_MONTHLY_KPI;
  const vehicleSummaries: VehicleMonthlySummary[] = MOCK_VEHICLE_SUMMARIES;

  // Compact stat pills
  const statPills = [
    { label: 'Total Approved TOs', value: kpi.totalApprovedTOs, icon: <FileText className="size-3.5" /> },
    { label: 'GPS Trips', value: kpi.totalGpsTripsRecorded, icon: <MapPin className="size-3.5" /> },
    { label: 'Total Distance', value: `${(kpi.totalGpsDistanceKm / 1000).toFixed(1)}k km`, icon: <Gauge className="size-3.5" /> },
    { label: 'Linked TOs', value: kpi.tripsWithLinkedTO, icon: <CheckCircle2 className="size-3.5" /> },
    { label: 'Unauthorized', value: kpi.unauthorizedTripsFlagged, icon: <XCircle className="size-3.5" /> },
    { label: 'Variance Issues', value: kpi.varianceExceedances, icon: <AlertTriangle className="size-3.5" /> },
    { label: 'Approval Rate', value: `${kpi.toApprovalRatePct.toFixed(1)}%`, icon: <TrendingUp className="size-3.5" /> },
    { label: 'Avg Trip Dist.', value: `${kpi.averageGpsTripDistanceKm.toFixed(1)} km`, icon: <BarChart3 className="size-3.5" /> },
  ];

  return (
    <div className="space-y-3">
      {/* ── Compact Stats Pills ── */}
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

      {/* ── Per-Vehicle Summary Table ── */}
      <div>
        <div className={tableContainerClass}>
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
              {vehicleSummaries.map((vs) => (
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
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile vehicle cards */}
        <div className="space-y-3 md:hidden">
          {vehicleSummaries.map((vs) => (
            <div key={vs.vehiclePlateNo} className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100">
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