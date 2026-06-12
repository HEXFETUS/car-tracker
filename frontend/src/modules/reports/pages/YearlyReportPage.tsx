import { cn } from '@/shared/lib/utils';
import {
  MOCK_YEARLY_KPI,
  MOCK_MONTHLY_AGGREGATES,
} from '@/modules/reports/mock-data';
import type { YearlyKpi, MonthlyAggregate } from '@/modules/reports/types';
import {
  Calendar,
  Gauge,
  MapPin,
  FileText,
  AlertTriangle,
  XCircle,
  TrendingUp,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react';

function TrendIndicator({ current, previous }: { current: number; previous: number }) {
  if (current > previous) {
    return <ArrowUp className="size-4 text-red-500" />;
  }
  if (current < previous) {
    return <ArrowDown className="size-4 text-brand-sage" />;
  }
  return <Minus className="size-4 text-zinc-300" />;
}

export function YearlyReportPage() {
  const kpi: YearlyKpi = MOCK_YEARLY_KPI;
  const monthlyData: MonthlyAggregate[] = MOCK_MONTHLY_AGGREGATES;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
          Yearly Report
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Macro-level overview &mdash; H1 2026
        </p>
      </div>

      {/* Yearly KPI Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Total Annual Distance
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
                {kpi.totalAnnualDistanceKm.toLocaleString()} km
              </p>
            </div>
            <div className="rounded-lg bg-brand-moss/30 p-2.5 text-brand-teal">
              <Gauge className="size-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Total Annual Trips
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
                {kpi.totalAnnualTrips}
              </p>
            </div>
            <div className="rounded-lg bg-brand-moss/30 p-2.5 text-brand-teal">
              <MapPin className="size-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg ring-1 ring-brand-teal/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Total Approved TOs
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
                {kpi.totalApprovedTOs}
              </p>
            </div>
            <div className="rounded-lg bg-brand-moss/30 p-2.5 text-brand-teal">
              <FileText className="size-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Unauthorized Trips (Year)
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-red-600">
                {kpi.unauthorizedTripsYear}
              </p>
            </div>
            <div className="rounded-lg bg-red-50 p-2.5 text-red-500">
              <XCircle className="size-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg ring-1 ring-brand-teal/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Variance Issues Flagged
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-red-600">
                {kpi.varianceIssuesFlaggedYear}
              </p>
            </div>
            <div className="rounded-lg bg-red-50 p-2.5 text-red-500">
              <AlertTriangle className="size-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Avg Monthly Distance
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
                {kpi.avgMonthlyDistanceKm.toLocaleString()} km
              </p>
            </div>
            <div className="rounded-lg bg-brand-moss/30 p-2.5 text-brand-teal">
              <BarChart3 className="size-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-brand transition-all hover:shadow-brand-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                TO Approval Rate (Year)
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
                {kpi.toApprovalRateYearPct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg bg-brand-moss/30 p-2.5 text-brand-teal">
              <TrendingUp className="size-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Month-over-Month Trend Bars */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">
          Monthly Distance & Variance Trends
        </h2>
        <div className="space-y-3">
          {monthlyData.map((m, idx) => {
            const maxDistance = Math.max(...monthlyData.map((d) => d.totalDistanceKm));
            const barWidthPct = (m.totalDistanceKm / maxDistance) * 100;
            const prev = idx > 0 ? monthlyData[idx - 1] : null;

            return (
              <div
                key={m.month}
                className="rounded-xl bg-white p-4 shadow-brand transition-all hover:shadow-brand-lg"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-brand-moss/30 text-xs font-bold text-brand-teal">
                      {m.month}
                    </div>
                    <div>
                      <p className="font-medium text-zinc-900">{m.month} 2026</p>
                      <p className="text-xs text-zinc-400">
                        {m.totalTrips} trips &middot; {m.totalApprovedTOs} TOs
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-right">
                      <p className="text-zinc-400">Distance</p>
                      <p className="font-semibold text-zinc-900">
                        {m.totalDistanceKm.toLocaleString()} km
                      </p>
                    </div>
                    {prev && (
                      <div className="text-right">
                        <p className="text-zinc-400">vs Prev</p>
                        <div className="flex items-center justify-end gap-0.5 font-semibold">
                          <TrendIndicator current={m.totalDistanceKm} previous={prev.totalDistanceKm} />
                          <span
                            className={cn(
                              m.totalDistanceKm > prev.totalDistanceKm
                                ? 'text-red-500'
                                : m.totalDistanceKm < prev.totalDistanceKm
                                ? 'text-brand-sage'
                                : 'text-zinc-400'
                            )}
                          >
                            {((m.totalDistanceKm - prev.totalDistanceKm) / prev.totalDistanceKm * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="text-right">
                      <p className="text-zinc-400">Variance Flagged</p>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
                          m.varianceIssuesFlagged > 0
                            ? 'bg-red-100 text-red-600'
                            : 'bg-brand-sage/20 text-brand-sage'
                        )}
                      >
                        {m.varianceIssuesFlagged}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Visual bar */}
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-brand-cream">
                  <div
                    className="h-full rounded-full bg-brand-teal transition-all"
                    style={{ width: `${barWidthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary footer */}
      <div className="rounded-xl bg-white p-5 shadow-brand">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-zinc-400" />
            <span className="text-zinc-500">Reporting Period:</span>
            <span className="font-medium text-zinc-900">H1 2026 (Jan &ndash; Jun)</span>
          </div>
          <div className="flex items-center gap-6">
            <div>
              <span className="text-zinc-400">Avg Trips / Month: </span>
              <span className="font-semibold text-zinc-900">
                {(kpi.totalAnnualTrips / monthlyData.length).toFixed(0)}
              </span>
            </div>
            <div>
              <span className="text-zinc-400">Avg TOs / Month: </span>
              <span className="font-semibold text-zinc-900">
                {(kpi.totalApprovedTOs / monthlyData.length).toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}