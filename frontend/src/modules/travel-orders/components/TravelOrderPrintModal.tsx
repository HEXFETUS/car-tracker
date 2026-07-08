import { useRef, useEffect, useState } from 'react';
import { X, Printer, Download } from 'lucide-react';
import html2canvas from 'html2canvas';
import type { TravelOrderData } from '../api/travel-orders-api';
import { TravelOrderPrintable } from './TravelOrderPrintable';

interface TravelOrderPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: TravelOrderData;
}

export function TravelOrderPrintModal({ isOpen, onClose, order }: TravelOrderPrintModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // Reset scroll position when modal opens
  useEffect(() => {
    if (isOpen) {
      window.scrollTo(0, 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    const element = printRef.current;
    if (!element) return;

    setDownloading(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
      });

      const link = document.createElement('a');
      link.download = `Travel_Order_${order.toNumber}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Failed to download travel order image:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      >
      <div className="relative w-full max-w-5xl max-h-[100svh] sm:max-h-[calc(100svh-40px)] bg-white rounded-2xl shadow-brand-xl flex flex-col">
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
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 scroll-smooth print-preview-content">
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
            disabled={downloading}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Download className="size-4" />
            {downloading ? 'Downloading...' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
