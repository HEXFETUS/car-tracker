import { Download } from 'lucide-react';
import { useState } from 'react';

interface ReportExportButtonProps {
  onExport?: (format: 'pdf' | 'csv' | 'excel') => void;
  variant?: 'toolbar' | 'modal';
}

export function ReportExportButton({ onExport, variant = 'toolbar' }: ReportExportButtonProps) {
  const [showModal, setShowModal] = useState(false);

  const handleExport = (format: 'pdf' | 'csv' | 'excel') => {
    setShowModal(false);
    onExport?.(format);
  };

  if (variant === 'modal') {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-brand-teal px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
        >
          <Download className="size-4" />
          <span>Export</span>
        </button>

        {/* Export format modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-zinc-900">Export Report?</h3>
              <p className="mt-1 text-sm text-zinc-500">Choose format:</p>
              <div className="mt-4 flex flex-col gap-2">
                {(['PDF', 'CSV', 'Excel'] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => handleExport(format.toLowerCase() as 'pdf' | 'csv' | 'excel')}
                    className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:border-brand-teal/30"
                  >
                    {format}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <button
      onClick={() => setShowModal(true)}
      className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
    >
      <Download className="size-4" />
      <span className="hidden sm:inline">Export</span>
    </button>
  );
}