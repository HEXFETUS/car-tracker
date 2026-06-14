import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Eye } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { NewTravelOrderModal } from '../components/NewTravelOrderModal';
import { TravelOrderDetailsModal } from '../components/TravelOrderDetailsModal';
import { fetchTravelOrders, createTravelOrder, type TravelOrderData } from '../api/travel-orders-api';
import type { TravelOrder } from '../types';

export function TravelOrdersPage() {
  const { toast, confirm } = useNotification();
  const [orders, setOrders] = useState<TravelOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<TravelOrderData | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchTravelOrders();
      setOrders(data);
    } catch (err) {
      toast('Failed to load travel orders', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  async function handleCreate(order: TravelOrder) {
    const confirmed = await confirm({
      title: 'Save Travel Order?',
      message: `You are about to create a new travel order from "${order.boundFrom}" to "${order.boundTo}" for ${order.travelerName}. This action can be modified later.`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      await createTravelOrder({
        originLocation: order.boundFrom,
        destinationLocation: order.boundTo,
        scheduledDepartureAt: order.departureDateTime,
        scheduledArrivalAt: order.returnDateTime,
        purpose: order.purpose,
        notes: order.remarks,
        department: order.department,
        travelerName: order.travelerName,
        requestVehicle: order.requestVehicle,
        requestDriver: order.requestDriver,
      });
      toast('Travel order created!', 'success');
      setIsModalOpen(false);
      await loadOrders();
    } catch (err: any) {
      toast(err.message || 'Failed to create travel order', 'error');
    }
  }

  function handleViewDetails(order: TravelOrderData) {
    setSelectedOrder(order);
    setIsDetailsOpen(true);
  }

  function formatToNumber(toNumber: number) {
    const year = new Date().getFullYear();
    return `TO-${year}-${String(toNumber).padStart(4, '0')}`;
  }

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return null;
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
      PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      APPROVED: 'bg-blue-100 text-blue-800 border-blue-200',
      ACTIVE: 'bg-green-100 text-green-800 border-green-200',
      COMPLETED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
      CANCELLED: 'bg-red-100 text-red-800 border-red-200',
    };
    return `rounded-full px-3 py-0.5 text-xs font-medium border ${colors[status] || 'bg-zinc-100 text-zinc-600 border-zinc-200'}`;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            Travel Orders
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {orders.length} order{orders.length !== 1 ? 's' : ''} on record.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
        >
          <Plus className="size-4" />
          New Travel Order
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading travel orders…</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <p className="text-base font-medium text-zinc-600">No travel orders yet</p>
          <p className="mt-1 text-sm text-zinc-400">
            Click "New Travel Order" to create one.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <div
              key={order.id}
              className="group flex flex-col rounded-xl bg-white shadow-brand transition-all hover:shadow-brand-lg hover:-translate-y-0.5"
            >
              {/* Header: TO Number + Purpose */}
              <div className="flex items-start justify-between rounded-t-xl bg-brand-cream px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-brand-teal truncate">
                      {formatToNumber(order.toNumber)}
                    </p>
                    <span className={statusBadge(order.status)}>{order.status}</span>
                  </div>
                  {order.purpose && (
                    <p className="mt-1.5 text-sm font-medium text-zinc-700 line-clamp-2">
                      {order.purpose}
                    </p>
                  )}
                </div>
              </div>

              {/* Body: Details */}
              <div className="flex flex-1 flex-col gap-2.5 px-5 py-4">
                <InfoRow label="Traveler" value={order.travelerName} />
                <InfoRow
                  label="Route"
                  value={`${order.originLocation || '—'} → ${order.destinationLocation}`}
                />
                {order.scheduledDepartureAt && (
                  <InfoRow label="Departure" value={formatDateTime(order.scheduledDepartureAt)} />
                )}
                {order.scheduledArrivalAt && (
                  <InfoRow label="Return" value={formatDateTime(order.scheduledArrivalAt)} />
                )}
                {order.plateNumber && (
                  <InfoRow label="Vehicle" value={order.plateNumber} />
                )}
                {order.driverName && (
                  <InfoRow label="Driver" value={order.driverName} />
                )}
              </div>

              {/* Footer: View Details */}
              <div className="flex items-center justify-end border-t border-zinc-100 px-5 py-3">
                <button
                  onClick={() => handleViewDetails(order)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                >
                  <Eye className="size-3.5" />
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Travel Order Modal */}
      <NewTravelOrderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreate}
        existingCount={orders.length}
      />

      {/* Travel Order Details Modal */}
      <TravelOrderDetailsModal
        isOpen={isDetailsOpen}
        onClose={() => { setIsDetailsOpen(false); setSelectedOrder(null); }}
        order={selectedOrder}
        onSuccess={loadOrders}
      />
    </div>
  );
}

/** Small helper to render a key-value row in the card body */
function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-900 truncate ml-2 max-w-[60%]" title={value || ''}>
        {value || '—'}
      </span>
    </div>
  );
}