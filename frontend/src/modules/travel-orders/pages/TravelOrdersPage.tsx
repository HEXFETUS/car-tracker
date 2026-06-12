import { useState } from 'react';
import { Plus, MapPin, Calendar, User, Building2, Plane } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { NewTravelOrderModal } from '../components/NewTravelOrderModal';
import type { TravelOrder } from '../types';

const MOCK_PENDING_ORDERS: TravelOrder[] = [
  {
    toNumber: 'TO-2026-0001',
    dateIssued: '2026-06-10',
    department: 'Human Resources',
    travelerName: 'Maria Santos',
    departureDateTime: '2026-06-15T08:00',
    returnDateTime: '2026-06-16T17:00',
    boundFrom: 'Manila',
    boundTo: 'Cebu',
    purpose: 'Regional recruitment and onboarding seminar',
    requestVehicle: true,
    requestDriver: false,
    remarks: 'Need hotel accommodation recommendations',
    imageAttachment: null,
    status: 'pending',
  },
  {
    toNumber: 'TO-2026-0002',
    dateIssued: '2026-06-11',
    department: 'Finance',
    travelerName: 'Jose Rizal II',
    departureDateTime: '2026-06-18T06:30',
    returnDateTime: '2026-06-18T20:00',
    boundFrom: 'Makati',
    boundTo: 'Clark',
    purpose: 'Audit compliance meeting with regional office',
    requestVehicle: true,
    requestDriver: true,
    remarks: '',
    imageAttachment: null,
    status: 'pending',
  },
  {
    toNumber: 'TO-2026-0003',
    dateIssued: '2026-06-12',
    department: 'IT Department',
    travelerName: 'Ana Gonzales',
    departureDateTime: '2026-06-20T09:00',
    returnDateTime: '2026-06-22T18:00',
    boundFrom: 'Quezon City',
    boundTo: 'Davao',
    purpose: 'IT infrastructure assessment for new branch office',
    requestVehicle: false,
    requestDriver: false,
    remarks: undefined,
    imageAttachment: null,
    status: 'pending',
  },
];

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TravelOrderCardProps {
  order: TravelOrder;
}

function TravelOrderCard({ order }: TravelOrderCardProps) {
  return (
    <div className="group rounded-xl bg-white shadow-brand transition-all hover:shadow-brand-lg">
      {/* Card header */}
      <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand-moss/50">
            <Plane className="size-4 text-brand-teal" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900">{order.toNumber}</p>
            <p className="text-xs text-zinc-400">{order.dateIssued}</p>
          </div>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-0.5 text-xs font-medium',
            'bg-brand-moss/40 text-brand-teal'
          )}
        >
          Pending
        </span>
      </div>

      {/* Card body */}
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <User className="size-4 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 truncate">
              {order.travelerName}
            </p>
            <p className="text-xs text-zinc-400">Traveler</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Building2 className="size-4 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <p className="text-sm text-zinc-700 truncate">{order.department}</p>
            <p className="text-xs text-zinc-400">Department</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <MapPin className="size-4 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <p className="text-sm text-zinc-700 truncate">
              {order.boundFrom} → {order.boundTo}
            </p>
            <p className="text-xs text-zinc-400">Destination</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Calendar className="size-4 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <p className="text-sm text-zinc-700 truncate">
              {formatDateTime(order.departureDateTime)}
            </p>
            <p className="text-xs text-zinc-400">Departure</p>
          </div>
        </div>

        {/* Vehicle/Driver tags */}
        {(order.requestVehicle || order.requestDriver) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {order.requestVehicle && (
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                🚗 Vehicle
              </span>
            )}
            {order.requestDriver && (
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                👤 Driver
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function TravelOrdersPage() {
  const [orders, setOrders] = useState<TravelOrder[]>(MOCK_PENDING_ORDERS);
  const [isModalOpen, setIsModalOpen] = useState(false);

  function handleNewOrder(order: TravelOrder) {
    setOrders((prev) => [order, ...prev]);
    setIsModalOpen(false);
  }

  const pendingOrders = orders.filter((o) => o.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            Travel Orders
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {pendingOrders.length} pending request{pendingOrders.length !== 1 ? 's' : ''}.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
        >
          <Plus className="size-4" />
          + New Travel Order
        </button>
      </div>

      {/* Pending Requests Section */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-zinc-800">
          Pending Requests
        </h2>
        {pendingOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
            <Plane className="size-10 text-zinc-300 mb-3" />
            <p className="text-base font-medium text-zinc-600">No pending travel orders</p>
            <p className="mt-1 text-sm text-zinc-400">
              Click "+ New Travel Order" to create one.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {pendingOrders.map((order) => (
              <TravelOrderCard key={order.toNumber} order={order} />
            ))}
          </div>
        )}
      </section>

      {/* New Travel Order Modal */}
      <NewTravelOrderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleNewOrder}
        existingCount={orders.length}
      />
    </div>
  );
}