import { Eye, Download, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { ReportRow } from './ReportTable';

const STATUS_COLORS: Record<string, string> = {
  Generated: 'bg-brand-sage/20 text-brand-sage',
  Pending: 'bg-amber-100 text-amber-700',
  Exported: 'bg-blue-100 text-blue-700',
  Failed: 'bg-red-100 text-red-600',
};

interface ReportCardProps {
  report: ReportRow;
  onView?: (report: ReportRow) => void;
  onExport?: (report: ReportRow) => void;
}

export function ReportCard({ report, onView, onExport }: ReportCardProps) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileSpreadsheet className="size-4 text-brand-teal shrink-0" />
          <p className="text-sm font-medium text-zinc-900 truncate">{report.reportNo}</p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0',
            STATUS_COLORS[report.status] || 'bg-zinc-100 text-zinc-600'
          )}
        >
          {report.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-zinc-400">Type</p>
          <p className="font-medium text-zinc-700">{report.type}</p>
        </div>
        <div>
          <p className="text-zinc-400">Date Range</p>
          <p className="text-zinc-700">{report.dateRange}</p>
        </div>
        <div>
          <p className="text-zinc-400">Vehicle / Driver</p>
          <p className="text-zinc-700 truncate">{report.vehicleDriver}</p>
        </div>
        <div>
          <p className="text-zinc-400">Generated At</p>
          <p className="text-zinc-500">{report.generatedAt}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
        {onView && (
          <button
            onClick={() => onView(report)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-teal transition-colors hover:bg-brand-moss/30"
          >
            <Eye className="size-3.5" />
            View
          </button>
        )}
        {onExport && (
          <button
            onClick={() => onExport(report)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
          >
            <Download className="size-3.5" />
            Export
          </button>
        )}
      </div>
    </div>
  );
}