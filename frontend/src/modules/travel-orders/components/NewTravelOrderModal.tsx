import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/modules/auth/context/auth-context';
import { TravelOrderForm } from './TravelOrderForm';
import type { TravelOrder } from '../types';

interface NewTravelOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (order: TravelOrder) => void;
  existingCount: number;
}

export function NewTravelOrderModal({
  isOpen,
  onClose,
  onSubmit,
  existingCount,
}: NewTravelOrderModalProps) {
  const { user } = useAuth();
  const modalRef = useRef<HTMLDivElement>(null);
  const canEditDateIssued = user?.userType === 'SUPERADMIN';

  // Reset scroll position when modal opens
  useEffect(() => {
    if (isOpen) {
      window.scrollTo(0, 0);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 py-0 sm:py-10 backdrop-blur-sm transition-opacity"
    >
      <div className="relative w-full max-w-4xl max-h-[100svh] sm:max-h-[calc(100svh-40px)] bg-white rounded-none sm:rounded-2xl shadow-brand-xl animate-in fade-in zoom-in-95 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">New Travel Order</h2>
            <p className="text-sm text-zinc-400">
              Fill in the details to create a new travel order request.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Form - scrollable area */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 scroll-smooth">
          <TravelOrderForm
            onSubmit={onSubmit}
            onCancel={onClose}
            existingCount={existingCount}
            canEditDateIssued={canEditDateIssued}
          />
        </div>
      </div>
    </div>
  );
}