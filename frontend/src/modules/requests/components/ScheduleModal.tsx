import { useEffect } from 'react';
import { X, Calendar, Clock, User, MapPin, ArrowRight, Truck, UserCircle } from 'lucide-react';
import type { PendingTravelOrder } from '../api/requests-api';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: Date;
  orders: PendingTravelOrder[];
}

const statusBadgeColors: Record<string, string> = {
  PENDING: 'bg-blue-100 text-blue-800 border-blue-200',
  FOR_REQUEST: 'bg-orange-100 text-orange-800 border-orange-200',
  FOR_APPROVAL: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  ACTIVE: 'bg-green-100 text-green-800 border-green-200',
  COMPLETED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
};

function StatusBadge({ status }: { status: string }) {
  const color = statusBadgeColors[status] || 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${color}`}>
      {status === 'FOR_REQUEST' ? 'FOR REQUEST' : status === 'FOR_APPROVAL' ? 'FOR APPROVAL' : status}
    </span>
  );
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-0 sm:py-10 backdrop-blur-sm transition-opacity"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg min-h-screen sm:min-h-0 animate-in fade-in zoom-in-95 rounded-none sm:rounded-2xl bg-white shadow-brand-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-brand-teal/10">
              <Calendar className="size-4 text-brand-teal" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">
                Scheduled Travel Order{orders.length !== 1 ? 's' : ''}
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

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
              <Calendar className="size-8 text-zinc-300 mb-2" />
              <p className="text-sm font-medium text-zinc-600">No scheduled orders</p>
              <p className="mt-0.5 text-xs text-zinc-400">No scheduled orders for this date.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-xl border border-zinc-100 bg-white p-4 shadow-sm space-y-3"
                >
                  {/* TO# + Status */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-brand-teal truncate">
                      {order.toNumber}
                    </h3>
                    <StatusBadge status={order.status} />
                  </div>

                  {/* Details */}
                  <div className="space-y-2.5 text-sm">
                    <div className="flex items-center gap-2 text-zinc-600">
                      <UserCircle className="size-3.5 shrink-0 text-brand-teal" />
                      <span className="font-medium text-zinc-500">Traveler:</span>
                      <span className="text-zinc-900">{order.travelerName || '—'}</span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-600">
                      <MapPin className="size-3.5 shrink-0 text-brand-teal" />
                      <span className="font-medium text-zinc-500">Route:</span>
                      <span className="text-zinc-900 truncate">
                        {order.originLocation || '—'} <ArrowRight className="inline size-3 text-zinc-400" /> {order.destinationLocation}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-600">
                      <Clock className="size-3.5 shrink-0 text-brand-teal" />
                      <span className="font-medium text-zinc-500">Departure:</span>
                      <span className="text-zinc-900">
                        {formatDateTime(order.scheduledDepartureAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-600">
                      <Clock className="size-3.5 shrink-0 text-brand-teal" />
                      <span className="font-medium text-zinc-500">Return:</span>
                      <span className="text-zinc-900">
                        {formatDateTime(order.scheduledArrivalAt)}
                      </span>
                    </div>

                    {order.plateNumber && (
                      <div className="flex items-center gap-2 text-zinc-600">
                        <Truck className="size-3.5 shrink-0 text-brand-teal" />
                        <span className="font-medium text-zinc-500">Vehicle:</span>
                        <span className="text-zinc-900">{order.plateNumber}</span>
                      </div>
                    )}

                    {order.driverName && (
                      <div className="flex items-center gap-2 text-zinc-600">
                        <User className="size-3.5 shrink-0 text-brand-teal" />
                        <span className="font-medium text-zinc-500">Driver:</span>
                        <span className="text-zinc-900">{order.driverName}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-zinc-100 bg-white rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}