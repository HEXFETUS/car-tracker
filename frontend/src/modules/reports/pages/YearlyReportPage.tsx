import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { fetchYearlyReport } from '@/modules/reports/api/reports-api';
import type { YearlyMonth, YearlySummary } from '@/modules/reports/types';
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
  Loader2,
  Inbox,
} from 'lucide-react';

interface YearlyReportPageProps {
  selectedYear: number;
}

function TrendIndicator({ current, previous }: { current: number; previous: number }) {
  if (current > previous) {
    return <ArrowUp className="size-4 text-red-500" />;
  }
  if (current < previous) {
    return <ArrowDown className="size-4 text-brand-sage" />;
  }
  return <Minus className="size-4 text-zinc-300" />;
}

export function YearlyReportPage({ selectedYear }: YearlyReportPageProps) {
  const [months, setMonths] = useState<YearlyMonth[]>([]);
  const [summary, setSummary] = useState<YearlySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchYearlyReport({ year });
      setMonths(data.months);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load yearly report');
      setMonths([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport(selectedYear);
  }, [selectedYear]);

  const statPills = useMemo(() => {
    if (!summary) return [];
    return [
      { label: 'Annual Distance', value: `${summary.annualDistanceKm.toLocaleString()} km`, icon: <Gauge className="size-3.5" /> },
      { label: 'Annual Trips', value: summary.annualTrips, icon: <MapPin className="size-3.5" /> },
      { label: 'Approved TOs', value: summary.approvedTOs, icon: <FileText className="size-3.5" /> },
      { label: 'Unauthorized', value: summary.unauthorizedTrips, icon: <XCircle className="size-3.5" /> },
      { label: 'Variance Issues', value: summary.varianceIssues, icon: <AlertTriangle className="size-3.5" /> },
      { label: 'Avg Monthly Dist.', value: `${summary.avgMonthlyDistanceKm.toLocaleString()} km`, icon: <BarChart3 className="size-3.5" /> },
      { label: 'Approval Rate', value: `${summary.approvalRate.toFixed(1)}%`, icon: <TrendingUp className="size-3.5" /> },
    ];
  }, [summary]);

  const hasData = months.some((m) => m.totalGpsTrips > 0 || m.totalApprovedTOs > 0);

  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" />
          Loading...
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}

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

      <div>
        <div className="space-y-3">
          {!hasData ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center">
              <Inbox className="size-8 text-zinc-300 mb-2" />
              <p className="text-sm text-zinc-500">No data available for {selectedYear}.</p>
            </div>
          ) : (
            months.map((m, idx) => {
              const maxDistance = Math.max(...months.map((d) => d.totalGpsDistanceKm));
              const barWidthPct = maxDistance > 0 ? (m.totalGpsDistanceKm / maxDistance) * 100 : 0;
              const prev = idx > 0 ? months[idx - 1] : null;

              return (
                <div
                  key={m.month}
                  className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100 transition-all hover:shadow-brand-lg"
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-brand-moss/30 text-xs font-bold text-brand-teal">
                        {m.monthLabel}
                      </div>
                      <div>
                        <p className="font-medium text-zinc-900">{m.monthLabel} {selectedYear}</p>
                        <p className="text-xs text-zinc-400">
                          {m.totalGpsTrips} trips · {m.totalApprovedTOs} TOs
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <p className="text-zinc-400">Distance</p>
                        <p className="font-semibold text-zinc-900">{m.totalGpsDistanceKm.toLocaleString()} km</p>
                      </div>
                      {prev && (
                        <div className="text-right">
                          <p className="text-zinc-400">vs Prev</p>
                          <div className="flex items-center justify-end gap-0.5 font-semibold">
                            <TrendIndicator current={m.totalGpsDistanceKm} previous={prev.totalGpsDistanceKm} />
                            <span
                              className={cn(
                                m.vsPreviousPercent == null
                                  ? 'text-zinc-400'
                                  : m.totalGpsDistanceKm > prev.totalGpsDistanceKm
                                    ? 'text-red-500'
                                    : m.totalGpsDistanceKm < prev.totalGpsDistanceKm
                                      ? 'text-brand-sage'
                                      : 'text-zinc-400'
                              )}
                            >
                              {m.vsPreviousPercent == null ? '—' : `${m.vsPreviousPercent.toFixed(1)}%`}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-zinc-400">Variance Flagged</p>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
                            m.varianceIssues > 0
                              ? 'bg-red-100 text-red-600'
                              : 'bg-brand-sage/20 text-brand-sage'
                          )}
                        >
                          {m.varianceIssues}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-brand-cream">
                    <div
                      className="h-full rounded-full bg-brand-teal transition-all"
                      style={{ width: `${barWidthPct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {summary && (
        <div className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-zinc-400" />
              <span className="text-zinc-500">Reporting Period:</span>
              <span className="font-medium text-zinc-900">{selectedYear}</span>
            </div>
            <div className="flex items-center gap-6">
              <div>
                <span className="text-zinc-400">Avg Trips / Month: </span>
                <span className="font-semibold text-zinc-900">{summary.avgTripsPerMonth.toFixed(0)}</span>
              </div>
              <div>
                <span className="text-zinc-400">Avg TOs / Month: </span>
                <span className="font-semibold text-zinc-900">{summary.avgTOsPerMonth.toFixed(0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}