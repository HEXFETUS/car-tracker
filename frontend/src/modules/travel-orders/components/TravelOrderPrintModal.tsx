import { useRef } from 'react';
import { X, Printer, Download } from 'lucide-react';
import type { TravelOrderData } from '../api/travel-orders-api';
import { TravelOrderPrintable } from './TravelOrderPrintable';

interface TravelOrderPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: TravelOrderData;
}

export function TravelOrderPrintModal({ isOpen, onClose, order }: TravelOrderPrintModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    window.print();
  };

  return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-brand-xl flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 shrink-0">
          <h3 className="text-base font-bold text-zinc-800">Print Travel Order</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 print-preview-content">
          <div
            id="travel-order-print"
            ref={printRef}
            className="to-print-sheet"
          >
            <TravelOrderPrintable order={order} />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-100 bg-white rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors inline-flex items-center gap-2"
          >
            <Printer className="size-4" />
            Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors inline-flex items-center gap-2"
          >
            <Download className="size-4" />
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
