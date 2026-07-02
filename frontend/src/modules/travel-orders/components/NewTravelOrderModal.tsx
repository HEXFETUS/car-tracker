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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-0 sm:py-10 backdrop-blur-sm transition-opacity"
      onClick={(e) => {
        if (e.target === modalRef.current) e.stopPropagation();
      }}
    >
      <div className="relative w-full max-w-4xl min-h-screen sm:min-h-0 animate-in fade-in zoom-in-95 rounded-none sm:rounded-2xl bg-white shadow-brand-xl flex flex-col">
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

        {/* Form */}
        <div className="flex-1 px-6 py-5 overflow-y-auto">
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