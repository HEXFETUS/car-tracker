import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, ClipboardCheck, Eye, CalendarDays, List, ChevronLeft, ChevronRight, Clock, User, Car, Search, RotateCcw, RefreshCw, MapPin, UserCircle, Truck } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { useAuth } from '@/modules/auth/context/auth-context';
import { canAccessTab } from '@/shared/config/role-access';
import { cn } from '@/shared/lib/utils';
import { formatDateTimeManila, formatDateManila } from '@/shared/lib/date-utils';
import {
  fetchForRequestOrders,
  fetchScheduledOrders,
  type PendingTravelOrder,
} from '../api/requests-api';
import { AssignModal } from '../components/AssignModal';
import { ScheduleModal } from '../components/ScheduleModal';
import { TravelOrderDetailsModal } from '@/modules/travel-orders/components/TravelOrderDetailsModal';
import type { TravelOrderData } from '@/modules/travel-orders/api/travel-orders-api';

type TabKey = 'request' | 'schedule';

const TABS: { key: TabKey; label: string; icon: typeof List }[] = [
  { key: 'request', label: 'Request', icon: List },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Status badge colors matching the new design spec */
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

export function RequestsPage() {
  const { toast } = useNotification();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('request');

  // Filter tabs based on user role
  const visibleTabs = useMemo(() => {
    if (!user) return [];
    return TABS.filter((tab) => canAccessTab('requests', tab.key, user.userType));
  }, [user]);

  // Ensure activeTab is always visible; reset to first visible tab if current is hidden
  const safeActiveTab = useMemo(() => {
    if (visibleTabs.length === 0) return activeTab;
    const isVisible = visibleTabs.some((t) => t.key === activeTab);
    return isVisible ? activeTab : visibleTabs[0].key;
  }, [activeTab, visibleTabs]);

  // Request tab state
  const [forRequestOrders, setForRequestOrders] = useState<PendingTravelOrder[]>([]);
  const [loadingRequest, setLoadingRequest] = useState(true);

  // Schedule tab state
  const [scheduledOrders, setScheduledOrders] = useState<PendingTravelOrder[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  // Order details modal state (for Request tab)
  const [selectedOrder, setSelectedOrder] = useState<PendingTravelOrder | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Assign modal state
  const [isAssignOpen, setIsAssignOpen] = useState(false);

  // Schedule tab - selected date & orders for side table
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedDateOrders, setSelectedDateOrders] = useState<PendingTravelOrder[]>([]);

  // Schedule modal state (for clicking an order row on schedule tab)
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | null>(null);
  const [scheduleOrders, setScheduleOrders] = useState<PendingTravelOrder[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  const loadForRequestOrders = useCallback(async () => {
    try {
      setLoadingRequest(true);
      const data = await fetchForRequestOrders();
      setForRequestOrders(data);
    } catch {
      toast('Failed to load for-request travel orders', 'error');
    } finally {
      setLoadingRequest(false);
    }
  }, [toast]);

  const loadScheduledOrders = useCallback(async () => {
    try {
      setLoadingScheduled(true);
      const data = await fetchScheduledOrders();
      setScheduledOrders(data);
    } catch {
      toast('Failed to load scheduled travel orders', 'error');
    } finally {
      setLoadingScheduled(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'request') {
      loadForRequestOrders();
    } else {
      loadScheduledOrders();
    }
  }, [activeTab, loadForRequestOrders, loadScheduledOrders]);

  // For Request tab - opens AssignModal
  function handleViewDetails(order: PendingTravelOrder) {
    setSelectedOrder(order);
    setIsAssignOpen(true);
  }

  // For Schedule tab side table - opens ScheduleModal
  function handleOpenScheduleOrder(order: PendingTravelOrder) {
    setScheduleDate(new Date(selectedDateKey + 'T00:00:00'));
    setScheduleOrders([order]);
    setIsScheduleOpen(true);
  }

  function formatToNumber(toNumber: string) {
    return toNumber;
  }

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return '—';
    return formatDateTimeManila(dateStr);
  }

  // ── Calendar helpers ─────────────────────────────────────────

  function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
  }

  function getDateKey(year: number, month: number, day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** Group scheduled orders by their departure date (YYYY-MM-DD key). */
  function groupOrdersByDate(): Map<string, PendingTravelOrder[]> {
    const groups = new Map<string, PendingTravelOrder[]>();
    for (const order of scheduledOrders) {
      if (!order.scheduledDepartureAt) continue;
      const d = new Date(order.scheduledDepartureAt);
      const key = getDateKey(d.getFullYear(), d.getMonth(), d.getDate());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(order);
    }
    return groups;
  }

  function handleDayClick(day: number) {
    const key = getDateKey(currentYear, currentMonth, day);
    const ordersForDate = groupedOrders.get(key) || [];
    if (ordersForDate.length === 0) return;

    if (selectedDateKey === key) {
      setSelectedDateKey(null);
      setSelectedDateOrders([]);
    } else {
      setSelectedDateKey(key);
      setSelectedDateOrders(ordersForDate);
    }
  }

  function prevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
    setSelectedDateKey(null);
    setSelectedDateOrders([]);
  }

  function nextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
    setSelectedDateKey(null);
    setSelectedDateOrders([]);
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const groupedOrders = groupOrdersByDate();
  const today = new Date();
  const todayKey = getDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  // ── Frontend-only filtering for Request tab ──
  const filteredForRequestOrders = useMemo(() => {
    let result = forRequestOrders;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          (o.toNumber && o.toNumber.toLowerCase().includes(q)) ||
          (o.travelerName && o.travelerName.toLowerCase().includes(q)) ||
          (o.purpose && o.purpose.toLowerCase().includes(q)) ||
          (o.originLocation && o.originLocation.toLowerCase().includes(q)) ||
          (o.destinationLocation && o.destinationLocation.toLowerCase().includes(q)) ||
          (o.plateNumber && o.plateNumber.toLowerCase().includes(q)) ||
          (o.driverName && o.driverName.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [forRequestOrders, searchQuery]);

  return (
    <div className="space-y-3">
      {/* ── Unified Toolbar ── */}
      <div className="rounded-xl bg-white shadow-brand border border-zinc-100 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* ── Tabs ── */}
          <div className="flex items-center gap-0.5 shrink-0 overflow-x-auto">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setSearchQuery('');
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                    safeActiveTab === tab.key
                      ? 'bg-brand-teal/10 text-brand-teal'
                      : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100',
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Clear search ── */}
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="inline-flex items-center justify-center size-10 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
              title="Clear search"
            >
              <RotateCcw className="size-4" />
            </button>
          )}

          {/* ── Spacer ── */}
          <div className="hidden lg:block flex-1 min-w-0" />

          {/* ── Search + Actions ── */}
          <div className="flex items-center gap-2">
            {safeActiveTab === 'request' && (
              <div className="relative w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search request #, traveler..."
                  className="w-full h-10 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 focus:border-brand-teal transition-all"
                />
              </div>
            )}
            <button
              onClick={safeActiveTab === 'request' ? loadForRequestOrders : loadScheduledOrders}
              disabled={safeActiveTab === 'request' ? loadingRequest : loadingScheduled}
              className="inline-flex items-center justify-center gap-1.5 h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('size-4', (safeActiveTab === 'request' ? loadingRequest : loadingScheduled) && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Request Tab ── */}
      {activeTab === 'request' && (
        <>
          {loadingRequest && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[200px] text-center shadow-brand border border-zinc-100">
              <Loader2 className="size-7 text-brand-teal animate-spin mb-2" />
              <p className="text-sm font-medium text-zinc-500">Loading requests…</p>
            </div>
          )}

          {!loadingRequest && filteredForRequestOrders.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[240px] text-center shadow-brand border border-zinc-100">
              {searchQuery ? (
                <>
                  <Search className="size-6 text-zinc-300 mb-2" />
                  <p className="text-sm font-medium text-zinc-600">No matching requests</p>
                  <p className="mt-1 text-xs text-zinc-400">Try changing your search query or clear it to see all requests.</p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    <RotateCcw className="size-3.5" />
                    Clear Filters
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-zinc-100">
                    <ClipboardCheck className="size-5 text-zinc-400" />
                  </div>
                  <p className="text-sm font-medium text-zinc-700">No requests found</p>
                  <p className="mt-0.5 text-xs text-zinc-400 max-w-sm">
                    No travel orders have been submitted for request yet.
                  </p>
                </>
              )}
            </div>
          )}

          {!loadingRequest && filteredForRequestOrders.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredForRequestOrders.map((order) => (
                <div
                  key={order.id}
                  className="group flex flex-col rounded-xl border border-zinc-100 bg-white shadow-brand transition-all hover:-translate-y-0.5 hover:shadow-brand-lg"
                >
                  {/* Header: TO Number + Status + Purpose */}
                  <div className="flex items-start justify-between px-4 pt-3 pb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-brand-teal truncate">
                          {formatToNumber(order.toNumber)}
                        </span>
                        <StatusBadge status={order.status} />
                      </div>
                      {order.purpose && (
                        <p className="mt-1 text-xs text-zinc-500 line-clamp-1">
                          {order.purpose}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Body: Details */}
                  <div className="flex flex-1 flex-col gap-1.5 px-4 py-2">
                    <CompactRow icon={<UserCircle className="size-3.5" />} label={order.travelerName} />
                    <CompactRow
                      icon={<MapPin className="size-3.5" />}
                      label={`${order.originLocation || '—'} → ${order.destinationLocation}`}
                    />
                    {order.scheduledDepartureAt && (
                      <CompactRow icon={<CalendarDays className="size-3.5" />} label={formatDateTime(order.scheduledDepartureAt)} />
                    )}
                    {order.scheduledArrivalAt && (
                      <CompactRow icon={<CalendarDays className="size-3.5" />} label={formatDateTime(order.scheduledArrivalAt)} />
                    )}
                    <CompactRow icon={<ClipboardCheck className="size-3.5" />} label={order.department} />
                    {order.plateNumber && (
                      <CompactRow icon={<Truck className="size-3.5" />} label={order.plateNumber} />
                    )}
                    {order.driverName && (
                      <CompactRow icon={<User className="size-3.5" />} label={order.driverName} />
                    )}
                  </div>

                  {/* Footer: View Details */}
                  <div className="flex items-center justify-end border-t border-zinc-100 px-4 py-2.5">
                    <button
                      onClick={() => handleViewDetails(order)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                    >
                      <Eye className="size-3.5" />
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Schedule Tab (Calendar + Side Table) ── */}
      {activeTab === 'schedule' && (
        <>
          {loadingScheduled && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[200px] text-center shadow-brand border border-zinc-100">
              <Loader2 className="size-7 text-brand-teal animate-spin mb-2" />
              <p className="text-sm font-medium text-zinc-500">Loading schedule…</p>
            </div>
          )}

          {!loadingScheduled && (
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Calendar */}
              <div className="rounded-xl bg-white shadow-brand border border-zinc-100 overflow-hidden w-full lg:max-w-[440px] shrink-0 self-start">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
                  <button
                    onClick={prevMonth}
                    className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <h2 className="text-sm font-bold text-zinc-900">
                    {MONTHS[currentMonth]} {currentYear}
                  </h2>
                  <button
                    onClick={nextMonth}
                    className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                <div className="p-3">
                  <div className="grid grid-cols-7 mb-1">
                    {WEEKDAYS.map((day) => (
                      <div
                        key={day}
                        className="text-center text-[11px] font-semibold text-zinc-400 uppercase py-1.5"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {Array.from({ length: firstDay }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square p-0.5" />
                    ))}

                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const key = getDateKey(currentYear, currentMonth, day);
                      const ordersForDay = groupedOrders.get(key) || [];
                      const isToday = key === todayKey;
                      const isSelected = key === selectedDateKey;
                      const hasOrders = ordersForDay.length > 0;

                      return (
                        <button
                          key={day}
                          onClick={() => handleDayClick(day)}
                          disabled={!hasOrders}
                          className={`
                            aspect-square p-0.5 rounded-lg text-xs transition-colors relative
                            ${isToday ? 'ring-2 ring-brand-teal ring-inset' : ''}
                            ${isSelected
                              ? 'bg-brand-teal text-white font-bold'
                              : hasOrders
                                ? 'bg-brand-cream hover:bg-brand-moss/30 cursor-pointer text-zinc-900 font-medium'
                                : 'text-zinc-400 cursor-default'
                            }
                          `}
                        >
                          <span className="flex items-center justify-center h-full w-full">
                            {day}
                          </span>
                          {hasOrders && !isSelected && (
                            <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-brand-teal text-[8px] font-bold text-white">
                              {ordersForDay.length}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Side Table - Orders for selected date */}
              <div className="rounded-xl bg-white shadow-brand border border-zinc-100 overflow-hidden w-full lg:max-w-[440px] shrink-0 self-start">
                {!selectedDateKey ? (
                  <div className="flex flex-col items-center justify-center px-6 min-h-[240px] text-center">
                    <CalendarDays className="size-8 text-zinc-300 mb-2" />
                    <p className="text-sm font-medium text-zinc-600">Select a date</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Click a date on the calendar to view scheduled orders.
                    </p>
                  </div>
                ) : selectedDateOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 min-h-[240px] text-center">
                    <p className="text-sm font-medium text-zinc-600">No orders</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      No scheduled orders for this date.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="px-5 py-3.5 border-b border-zinc-100">
                      <h3 className="text-sm font-bold text-zinc-900">
                        Scheduled Orders
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {formatDateManila(selectedDateKey + 'T00:00:00')}
                      </p>
                    </div>

                    <div className="divide-y divide-zinc-100 max-h-[400px] overflow-y-auto">
                      {selectedDateOrders.map((order) => (
                        <div
                          key={order.id}
                          onClick={() => handleOpenScheduleOrder(order)}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-brand-cream/50 cursor-pointer transition-colors group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-bold text-brand-teal truncate group-hover:underline">
                                {order.toNumber}
                              </p>
                              <StatusBadge status={order.status} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                              <span className="inline-flex items-center gap-1">
                                <User className="size-3" />
                                {order.driverName || order.travelerName || '—'}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Car className="size-3" />
                                {order.plateNumber || '—'}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Clock className="size-3" />
                                {formatDateTime(order.scheduledDepartureAt)}
                              </span>
                            </div>
                          </div>
                          <Eye className="size-3.5 text-zinc-300 group-hover:text-brand-teal transition-colors shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Travel Order Details Modal (for Request tab) */}
      <TravelOrderDetailsModal
        isOpen={isDetailsOpen}
        onClose={() => { setIsDetailsOpen(false); setSelectedOrder(null); }}
        order={selectedOrder as unknown as TravelOrderData}
        onSuccess={() => {
          loadForRequestOrders();
          setIsDetailsOpen(false);
          setSelectedOrder(null);
        }}
      />

      {/* Assign Modal (for Request tab) */}
      <AssignModal
        isOpen={isAssignOpen}
        onClose={() => { setIsAssignOpen(false); setSelectedOrder(null); }}
        order={selectedOrder}
        onSuccess={() => {
          loadForRequestOrders();
          setIsAssignOpen(false);
          setSelectedOrder(null);
        }}
      />

      {/* Schedule Modal (opened when clicking an order row in the side table) */}
      <ScheduleModal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        date={scheduleDate || new Date()}
        orders={scheduleOrders}
      />
    </div>
  );
}

/** Small helper to render a compact row with icon in the card body */
function CompactRow({ icon, label }: { icon: React.ReactNode; label: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-zinc-400 shrink-0">{icon}</span>
      <span className="text-zinc-700 truncate" title={label || ''}>
        {label || '—'}
      </span>
    </div>
  );
}