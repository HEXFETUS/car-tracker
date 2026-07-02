import { Eye, Download, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';

export interface ReportRow {
  id: string;
  reportNo: string;
  type: string;
  dateRange: string;
  vehicleDriver: string;
  status: string;
  generatedAt: string;
}

interface ReportTableProps {
  reports: ReportRow[];
  onView?: (report: ReportRow) => void;
  onExport?: (report: ReportRow) => void;
}

const STATUS_COLORS: Record<string, string> = {
  Generated: 'bg-brand-sage/20 text-brand-sage',
  Pending: 'bg-amber-100 text-amber-700',
  Exported: 'bg-blue-100 text-blue-700',
  Failed: 'bg-red-100 text-red-600',
};

export function ReportTable({ reports, onView, onExport }: ReportTableProps) {
  if (reports.length === 0) return null;

  return (
    <div className={tableContainerClass}>
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr className={tableHeaderClass}>
              <th className={tableHeaderCellClass}>Report No.</th>
              <th className={tableHeaderCellClass}>Type</th>
              <th className={tableHeaderCellClass}>Date Range</th>
              <th className={tableHeaderCellClass}>Vehicle / Driver</th>
              <th className={tableHeaderCellClass}>Status</th>
              <th className={tableHeaderCellClass}>Generated At</th>
              <th className={cn(tableHeaderCellClass, 'text-center')}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id} className={tableRowClass}>
                <td className={tableCellClass}>
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="size-4 text-brand-teal shrink-0" />
                    {report.reportNo}
                  </div>
                </td>
                <td className={tableCellClass}>{report.type}</td>
                <td className={tableCellClass}>{report.dateRange}</td>
                <td className={tableCellClass}>{report.vehicleDriver}</td>
                <td className={tableCellClass}>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      STATUS_COLORS[report.status] || 'bg-zinc-100 text-zinc-600'
                    )}
                  >
                    {report.status}
                  </span>
                </td>
                <td className={tableCellClass}>{report.generatedAt}</td>
                <td className={tableCellClass}>
                  <div className="flex items-center justify-center gap-1">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}