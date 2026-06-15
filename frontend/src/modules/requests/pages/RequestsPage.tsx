import { useState, useEffect, useCallback } from 'react';
import { Loader2, ClipboardCheck, Eye, CalendarDays, List, ChevronLeft, ChevronRight, Clock, User, Car } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
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

export function RequestsPage() {
  const { toast } = useNotification();
  const [activeTab, setActiveTab] = useState<TabKey>('request');

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
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      FOR_APPROVAL: 'bg-indigo-100 text-indigo-800',
      APPROVED: 'bg-blue-100 text-blue-800',
      ACTIVE: 'bg-green-100 text-green-800',
    };
    return `rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || 'bg-zinc-100 text-zinc-600'}`;
  };

  return (
    <div className="space-y-8">
      {/* Tab Bar — scrollable on mobile */}
      <div className="border-b border-zinc-200">
        <nav className="-mb-px flex gap-4 sm:gap-6 overflow-x-auto pb-px" aria-label="Travel request tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors
                  ${activeTab === tab.key
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
      </div>

      {/* ── Request Tab ── */}
      {activeTab === 'request' && (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 rounded-lg bg-brand-cream px-4 py-2.5">
              <ClipboardCheck className="size-4 text-brand-teal" />
              <span className="text-sm font-medium text-zinc-700">
                {forRequestOrders.length} request{forRequestOrders.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {loadingRequest && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
              <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
              <p className="text-base font-medium text-zinc-600">Loading requests…</p>
            </div>
          )}

          {!loadingRequest && forRequestOrders.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
              <ClipboardCheck className="size-10 text-zinc-300 mb-3" />
              <p className="text-base font-medium text-zinc-600">No travel requests</p>
              <p className="mt-1 text-sm text-zinc-400">
                No travel orders have been submitted for request yet.
              </p>
            </div>
          )}

          {!loadingRequest && forRequestOrders.length > 0 && (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {forRequestOrders.map((order) => (
                <div
                  key={order.id}
                  className="group flex flex-col rounded-xl bg-white shadow-brand transition-all hover:shadow-brand-lg hover:-translate-y-0.5"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between rounded-t-xl bg-brand-cream px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-brand-teal truncate">
                          {formatToNumber(order.toNumber)}
                        </p>
                        <span className="rounded-full bg-orange-100 text-orange-800 px-2.5 py-0.5 text-xs font-medium border border-orange-200">
                          {order.status}
                        </span>
                      </div>
                      {order.purpose && (
                        <p className="mt-1.5 text-sm font-medium text-zinc-700 line-clamp-2">
                          {order.purpose}
                        </p>
                      )}
                    </div>
                  </div>

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
                    <InfoRow label="Department" value={order.department} />
                  </div>

                  <div className="flex items-center justify-end border-t border-zinc-100 px-5 py-3">
                    <button
                      onClick={() => handleViewDetails(order)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors min-h-[44px]"
                    >
                      <Eye className="size-4" />
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
            <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
              <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
              <p className="text-base font-medium text-zinc-600">Loading schedule…</p>
            </div>
          )}

          {!loadingScheduled && (
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Calendar */}
              <div className="rounded-xl bg-white shadow-brand overflow-hidden w-full lg:max-w-[440px] shrink-0 self-start">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                  <button
                    onClick={prevMonth}
                    className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <h2 className="text-base font-bold text-zinc-900">
                    {MONTHS[currentMonth]} {currentYear}
                  </h2>
                  <button
                    onClick={nextMonth}
                    className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-7 mb-2">
                    {WEEKDAYS.map((day) => (
                      <div
                        key={day}
                        className="text-center text-xs font-semibold text-zinc-400 uppercase py-2"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {Array.from({ length: firstDay }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square p-1" />
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
                            aspect-square p-1 rounded-lg text-sm transition-colors relative
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
                            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand-teal text-[9px] font-bold text-white">
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
              <div className="rounded-xl bg-white shadow-brand overflow-hidden w-full lg:max-w-[440px] shrink-0 self-start">
                {!selectedDateKey ? (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-center h-full">
                    <CalendarDays className="size-10 text-zinc-300 mb-3" />
                    <p className="text-base font-medium text-zinc-600">Select a date</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Click a date on the calendar to view scheduled orders.
                    </p>
                  </div>
                ) : selectedDateOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-center h-full">
                    <p className="text-base font-medium text-zinc-600">No orders</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      No scheduled orders for this date.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="px-6 py-4 border-b border-zinc-100">
                      <h3 className="text-base font-bold text-zinc-900">
                        Scheduled Orders
                      </h3>
                      <p className="text-sm text-zinc-400">
                        {new Date(selectedDateKey + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>

                    <div className="divide-y divide-zinc-100 max-h-[420px] overflow-y-auto">
                      {selectedDateOrders.map((order) => (
                        <div
                          key={order.id}
                          onClick={() => handleOpenScheduleOrder(order)}
                          className="flex items-center gap-4 px-6 py-4 hover:bg-brand-cream/50 cursor-pointer transition-colors group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-bold text-brand-teal truncate group-hover:underline">
                                {order.toNumber}
                              </p>
                              <span className={`shrink-0 ${statusBadge(order.status)}`}>
                                {order.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
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
                          <Eye className="size-4 text-zinc-300 group-hover:text-brand-teal transition-colors shrink-0" />
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
