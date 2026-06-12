import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { NewTravelOrderModal } from '../components/NewTravelOrderModal';
import { fetchTravelOrders, createTravelOrder, type TravelOrderData } from '../api/travel-orders-api';
import type { TravelOrder } from '../types';

export function TravelOrdersPage() {
  const { toast, confirm } = useNotification();
  const [orders, setOrders] = useState<TravelOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  // The modal uses the legacy TravelOrder type; map it to our API payload.
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

  function formatToNumber(toNumber: number) {
    const year = new Date().getFullYear();
    return `TO-${year}-${String(toNumber).padStart(4, '0')}`;
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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
      PENDING: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-blue-100 text-blue-800',
      ACTIVE: 'bg-green-100 text-green-800',
      COMPLETED: 'bg-zinc-100 text-zinc-600',
      CANCELLED: 'bg-red-100 text-red-800',
    };
    return `rounded-full px-3 py-0.5 text-xs font-medium ${colors[status] || 'bg-zinc-100 text-zinc-600'}`;
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
              className="group flex flex-col rounded-xl bg-white shadow-brand transition-all hover:shadow-brand-lg"
            >
              {/* Header: TO Number + Purpose */}
              <div className="flex items-start justify-between rounded-t-xl bg-brand-cream px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-brand-teal">
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
                {order.travelerName && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Traveler</span>
                    <span className="font-medium text-zinc-900">{order.travelerName}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Route</span>
                  <span className="font-medium text-zinc-900">
                    {order.originLocation || '—'} → {order.destinationLocation}
                  </span>
                </div>

                {order.scheduledDepartureAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Departure</span>
                    <span className="font-medium text-zinc-900">
                      {formatDateTime(order.scheduledDepartureAt)}
                    </span>
                  </div>
                )}

                {order.scheduledArrivalAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Return</span>
                    <span className="font-medium text-zinc-900">
                      {formatDateTime(order.scheduledArrivalAt)}
                    </span>
                  </div>
                )}

                {order.plateNumber && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Vehicle</span>
                    <span className="font-medium text-zinc-900">{order.plateNumber}</span>
                  </div>
                )}

                {order.driverName && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Driver</span>
                    <span className="font-medium text-zinc-900">{order.driverName}</span>
                  </div>
                )}
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
    </div>
  );
}