import { useEffect } from 'react';
import { X, Calendar, Clock, User, MapPin, ArrowRight } from 'lucide-react';
import type { PendingTravelOrder } from '../api/requests-api';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: Date;
  orders: PendingTravelOrder[];
}

export function ScheduleModal({ isOpen, onClose, date, orders }: ScheduleModalProps) {
  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      FOR_APPROVAL: 'bg-indigo-100 text-indigo-800',
      APPROVED: 'bg-blue-100 text-blue-800',
      ACTIVE: 'bg-green-100 text-green-800',
    };
    return `rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || 'bg-zinc-100 text-zinc-600'}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm transition-opacity">
      <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Calendar className="size-5 text-brand-teal" />
            <div>
              <h2 className="text-lg font-bold text-zinc-900">
                Scheduled Travel Order
              </h2>
              <p className="text-sm text-zinc-400">
                {dateStr}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {orders.length === 0 ? (
            <p className="text-center text-sm text-zinc-400 py-8">No scheduled orders for this date.</p>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className="rounded-lg border border-zinc-100 bg-white p-4 space-y-3"
              >
                {/* TO# + Status */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-brand-teal truncate">
                    {order.toNumber}
                  </h3>
                  <span className={`shrink-0 ${statusBadge(order.status)}`}>
                    {order.status}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-2 text-sm">
                  {/* Traveler */}
                  <div className="flex items-center gap-2 text-zinc-600">
                    <User className="size-3.5 shrink-0" />
                    <span className="font-medium text-zinc-500">Traveler:</span>
                    <span className="text-zinc-900">{order.travelerName || '—'}</span>
                  </div>

                  {/* Route */}
                  <div className="flex items-center gap-2 text-zinc-600">
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="font-medium text-zinc-500">Route:</span>
                    <span className="text-zinc-900 truncate">
                      {order.originLocation || '—'} <ArrowRight className="inline size-3 text-zinc-400" /> {order.destinationLocation}
                    </span>
                  </div>

                  {/* Departure */}
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Clock className="size-3.5 shrink-0" />
                    <span className="font-medium text-zinc-500">Departure:</span>
                    <span className="text-zinc-900">
                      {formatDateTime(order.scheduledDepartureAt)}
                    </span>
                  </div>

                  {/* Return */}
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Clock className="size-3.5 shrink-0" />
                    <span className="font-medium text-zinc-500">Return:</span>
                    <span className="text-zinc-900">
                      {formatDateTime(order.scheduledArrivalAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}