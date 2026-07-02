import { X, FileSpreadsheet, Calendar, Truck, Download, MapPin } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface ReportDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: {
    reportNo: string;
    type: string;
    dateRange: string;
    vehicleDriver: string;
    status: string;
    generatedAt: string;
    summary?: string;
    remarks?: string;
  } | null;
  onExport?: () => void;
}

export function ReportDetailsModal({ isOpen, onClose, report, onExport }: ReportDetailsModalProps) {
  if (!isOpen || !report) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-brand-teal" />
            <h2 className="text-lg font-semibold text-zinc-900">Report Details</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Report Information */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Report Information
            </h3>
            <div className="rounded-lg bg-zinc-50 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Report No.</span>
                <span className="font-medium text-zinc-900">{report.reportNo}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Type</span>
                <span className="font-medium text-zinc-900">{report.type}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Status</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    report.status === 'Generated' && 'bg-brand-sage/20 text-brand-sage',
                    report.status === 'Pending' && 'bg-amber-100 text-amber-700',
                    report.status === 'Exported' && 'bg-blue-100 text-blue-700',
                    report.status === 'Failed' && 'bg-red-100 text-red-600',
                  )}
                >
                  {report.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Generated At</span>
                <span className="text-zinc-700">{report.generatedAt}</span>
              </div>
            </div>
          </div>

          {/* Coverage / Date Range */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Calendar className="size-3.5" />
              Coverage / Date Range
            </h3>
            <div className="rounded-lg bg-zinc-50 p-3">
              <p className="text-sm text-zinc-700">{report.dateRange}</p>
            </div>
          </div>

          {/* Vehicle / Driver */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Truck className="size-3.5" />
              Vehicle / Driver
            </h3>
            <div className="rounded-lg bg-zinc-50 p-3">
              <p className="text-sm text-zinc-700">{report.vehicleDriver}</p>
            </div>
          </div>

          {/* Summary */}
          {report.summary && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <MapPin className="size-3.5" />
                Summary
              </h3>
              <div className="rounded-lg bg-zinc-50 p-3">
                <p className="text-sm text-zinc-700">{report.summary}</p>
              </div>
            </div>
          )}

          {/* Remarks */}
          {report.remarks && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Remarks
              </h3>
              <div className="rounded-lg bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">{report.remarks}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4">
          {onExport && (
            <button
              onClick={onExport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <Download className="size-4" />
              Export
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}