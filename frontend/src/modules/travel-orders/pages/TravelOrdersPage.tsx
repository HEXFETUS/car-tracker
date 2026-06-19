import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Eye, Clock, ClipboardCheck, CheckCircle, XCircle } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { NewTravelOrderModal } from '../components/NewTravelOrderModal';
import { TravelOrderDetailsModal } from '../components/TravelOrderDetailsModal';
import {
  fetchPendingOrders,
  fetchForApprovalOrders,
  fetchApprovedOrders,
  fetchCancelledOrders,
  createTravelOrder,
  type TravelOrderData,
} from '../api/travel-orders-api';
import type { TravelOrder } from '../types';

/** Convert a datetime-local value (YYYY-MM-DDTHH:MM, local) to an ISO string with local timezone offset. */
function toLocalISO(datetimeLocal: string): string {
  if (!datetimeLocal) return datetimeLocal;
  const date = new Date(datetimeLocal);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${hours}:${minutes}`;
}

type TabKey = 'pending' | 'for-approval' | 'approved' | 'cancelled';

const TABS: { key: TabKey; label: string; icon: typeof Clock }[] = [
  { key: 'pending', label: 'Needs Assigning', icon: Clock },
  { key: 'for-approval', label: 'For Approval', icon: ClipboardCheck },
  { key: 'approved', label: 'Approved', icon: CheckCircle },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle },
];

export function TravelOrdersPage() {
  const { toast, confirm } = useNotification();
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [orders, setOrders] = useState<TravelOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<TravelOrderData | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data =
        activeTab === 'pending'
          ? await fetchPendingOrders()
          : activeTab === 'for-approval'
            ? await fetchForApprovalOrders()
            : activeTab === 'approved'
              ? await fetchApprovedOrders()
              : await fetchCancelledOrders();
      setOrders(data);
    } catch (err) {
      toast('Failed to load travel orders', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, toast]);

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
        toNumber: order.toNumber,
        originLocation: order.boundFrom,
        destinationLocation: order.boundTo,
        scheduledDepartureAt: toLocalISO(order.departureDateTime),
        scheduledArrivalAt: toLocalISO(order.returnDateTime),
        purpose: order.purpose,
        notes: order.remarks,
        department: order.department,
        travelerName: order.travelerName,
        requestVehicle: order.requestVehicle,
        requestDriver: order.requestDriver,
        latLongOrigin: order.latLongOrigin,
        latLongDestination: order.latLongDestination,
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

  function formatToNumber(toNumber: string) {
    // toNumber is now stored as a full string like "TO-2026-0001"
    return toNumber;
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
      FOR_APPROVAL: 'bg-indigo-100 text-indigo-800 border-indigo-200',
      APPROVED: 'bg-blue-100 text-blue-800 border-blue-200',
      ACTIVE: 'bg-green-100 text-green-800 border-green-200',
      COMPLETED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
      CANCELLED: 'bg-red-100 text-red-800 border-red-200',
    };
    return `rounded-full px-3 py-0.5 text-xs font-medium border ${colors[status] || 'bg-zinc-100 text-zinc-600 border-zinc-200'}`;
  };

  return (
    <div className="space-y-8">
      {/* Tab Bar + New Travel Order button — mobile: separate, desktop: inline */}
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between border-b border-zinc-200">
        <nav className="-mb-px flex gap-4 sm:gap-6 overflow-x-auto pb-px" aria-label="Travel order tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setOrders([]);
                }}
                className={`
                  inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors
                  ${
                    activeTab === tab.key
                      ? 'border-brand-teal text-brand-teal'
                      : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
                  }
                `}
                aria-current={activeTab === tab.key ? 'page' : undefined}
              >
                <Icon className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Mobile: small right-aligned button */}
        <div className="flex justify-end sm:hidden">
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
          >
            <Plus className="size-3.5" />
            New Travel Order
          </button>
        </div>

        {/* Desktop: original button */}
        <button
          onClick={() => setIsModalOpen(true)}
          className="hidden sm:inline-flex items-center justify-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
        >
          <Plus className="size-4" />
          New Travel Order
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">
            {activeTab === 'pending'
              ? 'Loading unassigned orders…'
              : activeTab === 'for-approval'
                ? 'Loading for-approval orders…'
                : activeTab === 'approved'
                  ? 'Loading approved orders…'
                  : 'Loading cancelled orders…'}
          </p>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <p className="text-base font-medium text-zinc-600">
            {activeTab === 'pending'
              ? 'No unassigned travel orders'
              : activeTab === 'for-approval'
                ? 'No orders pending approval'
                : activeTab === 'approved'
                  ? 'No approved travel orders'
                  : 'No cancelled travel orders'}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {activeTab === 'pending'
              ? 'Create a new travel order and assign a vehicle & driver to get started.'
              : activeTab === 'for-approval'
                ? 'Assigned orders will appear here once vehicle & driver are set.'
                : activeTab === 'approved'
                  ? 'Approved orders will appear here once they are approved.'
                  : 'Cancelled orders will appear here once they are rejected or cancelled.'}
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
                      {formatToNumber(order.toNumber as string)}
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
              <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
                {order.approvedByName && (
                  <span className="text-xs text-zinc-400">
                    Approved by <span className="font-medium text-zinc-600">{order.approvedByName}</span>
                  </span>
                )}
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
    <div className="flex items-start gap-2 text-sm">
      <span className="text-zinc-400 shrink-0 min-w-[75px]">{label}</span>
      <span className="font-medium text-zinc-900 break-words min-w-0" title={value || ''}>
        {value || '—'}
      </span>
    </div>
  );
}