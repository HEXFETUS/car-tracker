// ── Dashboard Drawer ────────────────────────────────────────────
//
// Right-side drawer that shows vehicle/trip/driver details without
// navigating away from the dashboard.

import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { X, Car, MapPin, Navigation, Gauge, AlertTriangle, Radio, ExternalLink, Star, Activity } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useDrawer, type DrawerView } from '@/shared/context/DrawerContext';
import { useRecentActivity } from '@/shared/context/RecentActivityContext';
import { useFavorites } from '@/shared/context/FavoritesContext';

// ── Helpers ────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSpeed(n: number): string {
  return n.toFixed(0) + ' km/h';
}

function fmtKm(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K km';
  return n.toFixed(0) + ' km';
}

// ── Mock data for drawer (in real app, fetch from API) ─────────

interface DrawerVehicleDetail {
  id: string;
  plateNumber: string;
  driverName: string;
  travelOrder: string;
  gpsNumber: string;
  tripType: string;
  currentSpeed: number;
  lastUpdated: string;
  destination: string;
  origin: string;
  latitude: number;
  longitude: number;
  status: string;
  engineHours: number;
  movingHours: number;
  distance: number;
  fuelLevel: number;
  photoUrl?: string;
}


// ── Section Component ──────────────────────────────────────────

function DrawerSection({ title, icon: Icon, children }: { title?: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-100 px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon className="size-4 text-brand-teal" />}
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function DrawerRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between py-1.5 text-sm', className)}>
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold text-zinc-900 text-right ml-4">{value}</span>
    </div>
  );
}

// ── Vehicle Drawer Content ─────────────────────────────────────

function VehicleDrawerContent({ view }: { view: Extract<DrawerView, { type: 'vehicle' }> }) {
  const navigate = useNavigate();
  const { closeDrawer } = useDrawer();
  const { addItem } = useRecentActivity();
  const { isFavorite, toggleFavorite } = useFavorites();

  // In a real app, fetch vehicle detail by ID
  const vehicle: DrawerVehicleDetail = {
    id: view.vehicleId,
    plateNumber: view.plateNumber || 'Unknown',
    driverName: 'Juan Dela Cruz',
    travelOrder: 'TO-2026-001',
    gpsNumber: 'GPS-001',
    tripType: 'Active Trip',
    currentSpeed: 42,
    lastUpdated: new Date().toISOString(),
    destination: 'Cagayan de Oro City',
    origin: 'Iligan City',
    latitude: 8.5,
    longitude: 124.65,
    status: 'ACTIVE',
    engineHours: 4.5,
    movingHours: 3.2,
    distance: 85,
    fuelLevel: 75,
  };

  const fav = isFavorite(vehicle.id, 'vehicle');
  const googleMapsUrl = `https://www.google.com/maps?q=${vehicle.latitude},${vehicle.longitude}`;

  useEffect(() => {
    addItem({ id: vehicle.id, type: 'vehicle', label: vehicle.plateNumber, subtitle: vehicle.driverName });
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-brand-teal/10">
            <Car className="size-5 text-brand-teal" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{vehicle.plateNumber}</h3>
            <p className="text-sm text-zinc-500">{vehicle.driverName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleFavorite({ id: vehicle.id, type: 'vehicle', label: vehicle.plateNumber, subtitle: vehicle.driverName })}
            className={cn('rounded-lg p-2 transition-colors hover:bg-zinc-100', fav ? 'text-amber-500' : 'text-zinc-300')}
            title={fav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className="size-4" fill={fav ? 'currentColor' : 'none'} />
          </button>
          <button onClick={closeDrawer} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Vehicle Photo */}
        <div className="flex items-center justify-center bg-zinc-50 py-8">
          <div className="flex size-20 items-center justify-center rounded-full bg-white shadow-sm ring-4 ring-brand-cream">
            <Car className="size-10 text-brand-teal/40" />
          </div>
        </div>

        <DrawerSection title="Vehicle" icon={Car}>
          <DrawerRow label="Plate Number" value={vehicle.plateNumber} />
          <DrawerRow label="Driver" value={vehicle.driverName} />
          <DrawerRow label="Travel Order" value={vehicle.travelOrder} />
          <DrawerRow label="GPS Number" value={vehicle.gpsNumber} />
          <DrawerRow label="Trip Type" value={vehicle.tripType} />
          <DrawerRow label="Status" value={
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">{vehicle.status}</span>
          } />
        </DrawerSection>

        <DrawerSection title="Telemetry" icon={Gauge}>
          <DrawerRow label="Current Speed" value={fmtSpeed(vehicle.currentSpeed)} />
          <DrawerRow label="Distance" value={fmtKm(vehicle.distance)} />
          <DrawerRow label="Engine Hours" value={`${vehicle.engineHours.toFixed(1)}h`} />
          <DrawerRow label="Moving Hours" value={`${vehicle.movingHours.toFixed(1)}h`} />
          <DrawerRow label="Fuel Level" value={
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 rounded-full bg-zinc-200">
                <div className={cn('h-2 rounded-full', vehicle.fuelLevel > 50 ? 'bg-emerald-500' : vehicle.fuelLevel > 25 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${vehicle.fuelLevel}%` }} />
              </div>
              <span className="text-xs">{vehicle.fuelLevel}%</span>
            </div>
          } />
          <DrawerRow label="Last Updated" value={fmtTime(vehicle.lastUpdated)} />
        </DrawerSection>

        <DrawerSection title="Route" icon={Navigation}>
          <DrawerRow label="Origin" value={vehicle.origin} />
          <DrawerRow label="Destination" value={vehicle.destination} />
        </DrawerSection>

        <DrawerSection title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { closeDrawer(); navigate(`/gps-logs?tripId=${vehicle.id}`); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-teal/90"
            >
              <Navigation className="size-4" />
              View Trip
            </button>
            <button
              onClick={() => { closeDrawer(); navigate('/gps-logs'); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-sage px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-sage/90"
            >
              <Radio className="size-4" />
              Fleet Tracking
            </button>
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            >
              <ExternalLink className="size-4" />
              Open Google Maps
            </a>
          </div>
        </DrawerSection>

        <DrawerSection>
          <button
            onClick={() => { closeDrawer(); navigate(`/list?vehicleId=${vehicle.id}`); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ExternalLink className="size-4" />
            Open Full Details
          </button>
        </DrawerSection>
      </div>
    </div>
  );
}

// ── Trip Drawer Content ────────────────────────────────────────

function TripDrawerContent({ view }: { view: Extract<DrawerView, { type: 'trip' }> }) {
  const navigate = useNavigate();
  const { closeDrawer } = useDrawer();
  const { addItem } = useRecentActivity();
  const { isFavorite, toggleFavorite } = useFavorites();

  const tripId = view.tripId;
  const toNumber = view.toNumber || 'TO-2026-001';
  const fav = isFavorite(tripId, 'trip');

  useEffect(() => {
    addItem({ id: tripId, type: 'trip', label: toNumber, subtitle: 'Active Trip' });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-brand-sage/10">
            <Navigation className="size-5 text-brand-sage" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{toNumber}</h3>
            <p className="text-sm text-zinc-500">Active Trip</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleFavorite({ id: tripId, type: 'trip', label: toNumber, subtitle: 'Active Trip' })}
            className={cn('rounded-lg p-2 transition-colors hover:bg-zinc-100', fav ? 'text-amber-500' : 'text-zinc-300')}
          >
            <Star className="size-4" fill={fav ? 'currentColor' : 'none'} />
          </button>
          <button onClick={closeDrawer} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DrawerSection title="Trip Details" icon={Navigation}>
          <DrawerRow label="TO Number" value={toNumber} />
          <DrawerRow label="Vehicle" value="ABC-1234" />
          <DrawerRow label="Driver" value="Juan Dela Cruz" />
          <DrawerRow label="GPS Number" value="GPS-001" />
          <DrawerRow label="Status" value={<span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">ACTIVE</span>} />
        </DrawerSection>

        <DrawerSection title="Route" icon={MapPin}>
          <DrawerRow label="Origin" value="Iligan City" />
          <DrawerRow label="Destination" value="Cagayan de Oro City" />
          <DrawerRow label="Distance" value="85 km" />
          <DrawerRow label="ETA" value="~30 mins" />
        </DrawerSection>

        <DrawerSection title="Progress" icon={Activity}>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Progress</span>
              <span className="font-bold text-zinc-900">65%</span>
            </div>
            <div className="h-2.5 rounded-full bg-brand-cream">
              <div className="h-2.5 rounded-full bg-brand-teal transition-all" style={{ width: '65%' }} />
            </div>
          </div>
          <DrawerRow label="Engine Hours" value="4.5h" />
          <DrawerRow label="Moving Hours" value="3.2h" />
        </DrawerSection>

        <DrawerSection title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { closeDrawer(); navigate(`/gps-logs?tripId=${tripId}`); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-teal/90"
            >
              <Navigation className="size-4" />
              View Trip
            </button>
            <button
              onClick={() => { closeDrawer(); navigate('/gps-logs'); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-sage px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-sage/90"
            >
              <Radio className="size-4" />
              Fleet Tracking
            </button>
          </div>
        </DrawerSection>

        <DrawerSection>
          <button
            onClick={() => { closeDrawer(); navigate(`/gps-logs?tripId=${tripId}`); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ExternalLink className="size-4" />
            Open Full Details
          </button>
        </DrawerSection>
      </div>
    </div>
  );
}

// ── Driver Drawer Content ──────────────────────────────────────

function DriverDrawerContent({ view }: { view: Extract<DrawerView, { type: 'driver' }> }) {
  const navigate = useNavigate();
  const { closeDrawer } = useDrawer();
  const { addItem } = useRecentActivity();
  const { isFavorite, toggleFavorite } = useFavorites();

  const driverId = view.driverId;
  const driverName = view.driverName || 'Unknown Driver';
  const fav = isFavorite(driverId, 'driver');

  useEffect(() => {
    addItem({ id: driverId, type: 'driver', label: driverName });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-amber-50">
            <div className="text-lg font-bold text-amber-600">{driverName.charAt(0)}</div>
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{driverName}</h3>
            <p className="text-sm text-zinc-500">Driver</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleFavorite({ id: driverId, type: 'driver', label: driverName })}
            className={cn('rounded-lg p-2 transition-colors hover:bg-zinc-100', fav ? 'text-amber-500' : 'text-zinc-300')}
          >
            <Star className="size-4" fill={fav ? 'currentColor' : 'none'} />
          </button>
          <button onClick={closeDrawer} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DrawerSection title="Driver Info" icon={Car}>
          <DrawerRow label="Name" value={driverName} />
          <DrawerRow label="Vehicle" value="ABC-1234" />
          <DrawerRow label="Contact" value="+63 912 345 6789" />
          <DrawerRow label="Status" value={<span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">Active</span>} />
        </DrawerSection>

        <DrawerSection title="Performance">
          <DrawerRow label="Total Trips" value="24" />
          <DrawerRow label="Total Distance" value={fmtKm(1850)} />
          <DrawerRow label="Avg Speed" value={fmtSpeed(38)} />
          <DrawerRow label="On-Time Rate" value="92%" />
          <DrawerRow label="Violations" value={<span className="text-red-600 font-bold">0</span>} />
        </DrawerSection>

        <DrawerSection>
          <button
            onClick={() => { closeDrawer(); navigate(`/list?driverId=${driverId}`); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ExternalLink className="size-4" />
            Open Full Details
          </button>
        </DrawerSection>
      </div>
    </div>
  );
}

// ── Travel Order Drawer Content ────────────────────────────────

function TravelOrderDrawerContent({ view }: { view: Extract<DrawerView, { type: 'travel-order' }> }) {
  const navigate = useNavigate();
  const { closeDrawer } = useDrawer();
  const { addItem } = useRecentActivity();
  const { isFavorite, toggleFavorite } = useFavorites();

  const orderId = view.orderId;
  const toNumber = view.toNumber || 'TO-2026-001';
  const fav = isFavorite(orderId, 'travel-order');

  useEffect(() => {
    addItem({ id: orderId, type: 'travel-order', label: toNumber });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-blue-50">
            <Navigation className="size-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{toNumber}</h3>
            <p className="text-sm text-zinc-500">Travel Order</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleFavorite({ id: orderId, type: 'travel-order', label: toNumber })}
            className={cn('rounded-lg p-2 transition-colors hover:bg-zinc-100', fav ? 'text-amber-500' : 'text-zinc-300')}
          >
            <Star className="size-4" fill={fav ? 'currentColor' : 'none'} />
          </button>
          <button onClick={closeDrawer} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DrawerSection title="Order Details" icon={Navigation}>
          <DrawerRow label="TO Number" value={toNumber} />
          <DrawerRow label="Vehicle" value="ABC-1234" />
          <DrawerRow label="Driver" value="Juan Dela Cruz" />
          <DrawerRow label="Status" value={<span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">ACTIVE</span>} />
        </DrawerSection>

        <DrawerSection title="Route" icon={MapPin}>
          <DrawerRow label="Origin" value="Iligan City" />
          <DrawerRow label="Destination" value="Cagayan de Oro City" />
          <DrawerRow label="Departure" value={fmtTime(new Date().toISOString())} />
          <DrawerRow label="Arrival" value="—" />
        </DrawerSection>

        <DrawerSection>
          <button
            onClick={() => { closeDrawer(); navigate(`/travel-orders?orderId=${orderId}`); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ExternalLink className="size-4" />
            Open Full Details
          </button>
        </DrawerSection>
      </div>
    </div>
  );
}

// ── Alert Drawer Content ───────────────────────────────────────

function AlertDrawerContent({ view: _view }: { view: Extract<DrawerView, { type: 'alert' }> }) {
  const navigate = useNavigate();
  const { closeDrawer } = useDrawer();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="size-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900">Alert Details</h3>
            <p className="text-sm text-zinc-500">GPS Alert</p>
          </div>
        </div>
        <button onClick={closeDrawer} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DrawerSection title="Alert Info" icon={AlertTriangle}>
          <DrawerRow label="Type" value={<span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">IDLING</span>} />
          <DrawerRow label="Vehicle" value="ABC-1234" />
          <DrawerRow label="Location" value="Iligan City" />
          <DrawerRow label="Time" value={fmtTime(new Date().toISOString())} />
        </DrawerSection>

        <DrawerSection>
          <button
            onClick={() => { closeDrawer(); navigate('/gps-logs?tab=alerts'); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ExternalLink className="size-4" />
            Open Full Details
          </button>
        </DrawerSection>
      </div>
    </div>
  );
}

// ── Main Drawer Component ──────────────────────────────────────

export function DashboardDrawer() {
  const { isOpen, view, closeDrawer } = useDrawer();

  const content = useMemo(() => {
    if (!view) return null;
    switch (view.type) {
      case 'vehicle':
        return <VehicleDrawerContent view={view} />;
      case 'trip':
        return <TripDrawerContent view={view} />;
      case 'driver':
        return <DriverDrawerContent view={view} />;
      case 'travel-order':
        return <TravelOrderDrawerContent view={view} />;
      case 'alert':
        return <AlertDrawerContent view={view} />;
      default:
        return null;
    }
  }, [view]);

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={closeDrawer}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {content}
      </div>
    </>
  );
}