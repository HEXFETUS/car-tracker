import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Loader2, Eye, MapPin, Calendar, User, Truck, UserCircle, Search, RotateCcw } from 'lucide-react';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import { useNotification } from '@/shared/context/NotificationContext';
import { NewTravelOrderModal } from '../components/NewTravelOrderModal';
import { TravelOrderDetailsModal } from '../components/TravelOrderDetailsModal';
import { TravelOrdersToolbar, type TabKey } from '../components/TravelOrdersToolbar';
import { useAuth } from '@/modules/auth/context/auth-context';
import { canAccessTab } from '@/shared/config/role-access';
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

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending', label: 'Needs Assigning' },
  { key: 'for-approval', label: 'For Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function TravelOrdersPage() {
  const { toast, confirm } = useNotification();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'pending' || tab === 'for-approval' || tab === 'approved' || tab === 'cancelled') {
      return tab as TabKey;
    }
    return 'pending';
  });
  const [orders, setOrders] = useState<TravelOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<TravelOrderData | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Filter tabs based on user role
  const visibleTabs = useMemo(() => {
    if (!user) return [];
    return TABS.filter((tab) => canAccessTab('travel-orders', tab.key, user.userType));
  }, [user]);

  // Ensure activeTab is always visible; reset to first visible tab if current is hidden
  const safeActiveTab = useMemo(() => {
    if (visibleTabs.length === 0) return activeTab;
    const isVisible = visibleTabs.some((t) => t.key === activeTab);
    return isVisible ? activeTab : visibleTabs[0].key;
  }, [activeTab, visibleTabs]);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data =
        safeActiveTab === 'pending'
          ? await fetchPendingOrders()
          : safeActiveTab === 'for-approval'
            ? await fetchForApprovalOrders()
            : safeActiveTab === 'approved'
              ? await fetchApprovedOrders()
              : await fetchCancelledOrders();
      setOrders(data);
    } catch (err) {
      toast('Failed to load travel orders', 'error');
    } finally {
      setLoading(false);
    }
  }, [safeActiveTab, toast]);

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
      const destinations = order.destinations?.map((d) => ({
        locationName: d.locationName,
        address: d.address || null,
        latLong: d.latLong || null,
        notes: d.notes || null,
        stopOrder: d.stopOrder,
      }));

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
        travelerSignature: order.travelerSignature ?? null,
        latLongOrigin: order.latLongOrigin,
        latLongDestination: order.latLongDestination,
        destinations,
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

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return null;
    return formatDateTimeManila(dateStr);
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-blue-100 text-blue-800 border-blue-200',
      FOR_REQUEST: 'bg-orange-100 text-orange-800 border-orange-200',
      FOR_APPROVAL: 'bg-orange-100 text-orange-800 border-orange-200',
      APPROVED: 'bg-green-100 text-green-800 border-green-200',
      ACTIVE: 'bg-green-100 text-green-800 border-green-200',
      COMPLETED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
      CANCELLED: 'bg-red-100 text-red-800 border-red-200',
    };
    return `shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium border ${colors[status] || 'bg-zinc-100 text-zinc-600 border-zinc-200'}`;
  };

  // ── Frontend-only filtering ──
  const filteredOrders = useMemo(() => {
    let result = orders;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          (o.toNumber && o.toNumber.toLowerCase().includes(q)) ||
          (o.travelerName && o.travelerName.toLowerCase().includes(q)) ||
          (o.originLocation && o.originLocation.toLowerCase().includes(q)) ||
          (o.destinationLocation && o.destinationLocation.toLowerCase().includes(q)) ||
          (o.plateNumber && o.plateNumber.toLowerCase().includes(q)) ||
          (o.driverName && o.driverName.toLowerCase().includes(q)) ||
          (o.purpose && o.purpose.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [orders, searchQuery]);

  // ── Empty state messages per tab ──
  const emptyMessages: Record<TabKey, { title: string; description: string }> = {
    pending: {
      title: 'No unassigned travel orders',
      description: 'Create a new travel order and assign a vehicle & driver to get started.',
    },
    'for-approval': {
      title: 'No orders pending approval',
      description: 'Assigned orders will appear here once vehicle & driver are set.',
    },
    approved: {
      title: 'No approved travel orders',
      description: 'Approved orders will appear here once they are approved.',
    },
    cancelled: {
      title: 'No cancelled travel orders',
      description: 'Cancelled orders will appear here once they are rejected or cancelled.',
    },
  };

  return (
    <div className="space-y-3">
      {/* ── Unified Toolbar ── */}
      <TravelOrdersToolbar
        activeTab={safeActiveTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setOrders([]);
          setSearchParams({ tab }, { replace: true });
        }}
        visibleTabs={visibleTabs}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={loadOrders}
        onNewOrder={() => setIsModalOpen(true)}
        loading={loading}
      />

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[200px] text-center shadow-brand border border-zinc-100">
          <Loader2 className="size-7 text-brand-teal animate-spin mb-2" />
          <p className="text-sm font-medium text-zinc-500">
            {safeActiveTab === 'pending'
              ? 'Loading unassigned orders…'
              : safeActiveTab === 'for-approval'
                ? 'Loading for-approval orders…'
                : safeActiveTab === 'approved'
                  ? 'Loading approved orders…'
                  : 'Loading cancelled orders…'}
          </p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[260px] text-center shadow-brand border border-zinc-100">
          {searchQuery ? (
            <>
              <Search className="size-6 text-zinc-300 mb-2" />
              <p className="text-sm font-medium text-zinc-600">No travel orders match your search</p>
              <p className="mt-1 text-xs text-zinc-400">Try changing your search query or clear it to see all orders.</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
              >
                <RotateCcw className="size-3.5" />
                Clear Search
              </button>
            </>
          ) : (
            <>
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-zinc-100">
                <Search className="size-5 text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-700">{emptyMessages[safeActiveTab].title}</p>
              <p className="mt-0.5 text-xs text-zinc-400 max-w-sm">{emptyMessages[safeActiveTab].description}</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
              >
                <Plus className="size-3.5" />
                New Travel Order
              </button>
            </>
          )}
        </div>
      ) : (
        /* ── Card View ── */
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="group flex min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-brand transition-all hover:-translate-y-0.5 hover:shadow-brand-lg"
            >
              {/* Header: TO Number + Status + Purpose */}
              <div className="flex min-w-0 items-start justify-between px-3 pb-2 pt-3 sm:px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-bold text-brand-teal">
                      {order.toNumber}
                    </span>
                    <span className={statusBadge(order.status)}>{order.status}</span>
                  </div>
                  {order.purpose && (
                    <p className="mt-1 line-clamp-2 break-words text-xs text-zinc-500 sm:line-clamp-1">
                      {order.purpose}
                    </p>
                  )}
                </div>
              </div>

              {/* Body: Details */}
              <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2 sm:px-4">
                <CompactRow icon={<User className="size-3.5" />} label={order.travelerName} />
                <CompactRow
                  icon={<MapPin className="size-3.5" />}
                  label={order.originLocation || '—'}
                />
                <CompactRow
                  icon={<MapPin className="size-3.5 text-brand-teal" />}
                  label={order.destinationLocation || '—'}
                />
                {order.scheduledDepartureAt && (
                  <CompactRow
                    icon={<Calendar className="size-3.5" />}
                    label={formatDateTime(order.scheduledDepartureAt)}
                  />
                )}
                {order.plateNumber && (
                  <CompactRow icon={<Truck className="size-3.5" />} label={order.plateNumber} />
                )}
                {order.driverName && (
                  <CompactRow icon={<UserCircle className="size-3.5" />} label={order.driverName} />
                )}
              </div>

              {/* Footer: Approved by + View Details */}
              <div className="flex min-w-0 flex-col gap-2 border-t border-zinc-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-2.5">
                {order.approvedByName ? (
                  <span className="min-w-0 break-words text-xs text-zinc-400 sm:truncate">
                    Approved by <span className="font-medium text-zinc-600">{order.approvedByName}</span>
                  </span>
                ) : (
                  <span />
                )}
                <button
                  onClick={() => handleViewDetails(order)}
                  className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1 rounded-lg bg-brand-teal/5 px-3 py-2 text-xs font-medium text-brand-teal transition-colors hover:bg-brand-teal/10 sm:min-h-0 sm:w-auto sm:bg-transparent sm:px-2.5 sm:py-1.5"
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

/** Small helper to render a compact row with icon in the card body */
function CompactRow({ icon, label }: { icon: React.ReactNode; label: string | null }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1 break-words leading-5 text-zinc-700 sm:truncate" title={label || ''}>
        {label || '—'}
      </span>
    </div>
  );
}
