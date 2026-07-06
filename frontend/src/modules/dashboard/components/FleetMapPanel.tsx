import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MapPin, Sparkles } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { cn } from '@/shared/lib/utils';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import type { LiveMonitoringRow } from '../api/dashboard-api';

// Ensure Leaflet default icon URLs are set (fixes blank markers in some bundlers)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

interface FleetMapPanelProps {
    vehicles: LiveMonitoringRow[];
    selectedVehicleId: string | null;
    onSelectVehicle: (vehicleId: string | null) => void;
    onOpenTripDetails: (tripId: string | null) => void;
}

type FilterKey = 'All' | 'Moving' | 'Idling' | 'Offline' | 'Alert' | 'No TO' | 'Maintenance Due';

function getVehicleStatus(row: LiveMonitoringRow): 'moving' | 'idling' | 'offline' | 'alert' {
    const speed = Number(row.speed_kmh ?? row.speed ?? 0);
    if (row.ignition === true && speed > 0) return 'moving';
    if (row.ignition === true && speed <= 0) return 'idling';
    if ((row as any).anomaly_flag || (row as any).alert_status) return 'alert';
    return 'offline';
}

function getStatusMeta(status: 'moving' | 'idling' | 'offline' | 'alert') {
    switch (status) {
        case 'moving':
            return { label: 'Moving', color: 'bg-emerald-500', ring: 'ring-emerald-200', badge: 'bg-emerald-50 text-emerald-700' };
        case 'idling':
            return { label: 'Idling', color: 'bg-amber-500', ring: 'ring-amber-200', badge: 'bg-amber-50 text-amber-700' };
        case 'offline':
            return { label: 'Offline', color: 'bg-zinc-400', ring: 'ring-zinc-200', badge: 'bg-zinc-100 text-zinc-600' };
        default:
            return { label: 'Alert', color: 'bg-red-500', ring: 'ring-red-200', badge: 'bg-red-50 text-red-700' };
    }
}

function getFilterCount(vehicles: LiveMonitoringRow[], filter: FilterKey) {
    return vehicles.filter((vehicle) => {
        const status = getVehicleStatus(vehicle);
        switch (filter) {
            case 'Moving':
                return status === 'moving';
            case 'Idling':
                return status === 'idling';
            case 'Offline':
                return status === 'offline';
            case 'Alert':
                return status === 'alert';
            case 'No TO':
                return !vehicle.current_travel_order;
            case 'Maintenance Due':
                return false;
            default:
                return true;
        }
    }).length;
}

function useDebouncedValue<T>(value: T, delay = 180) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
        return () => window.clearTimeout(timeout);
    }, [value, delay]);
    return debouncedValue;
}

export function FleetMapPanel({ vehicles, selectedVehicleId, onSelectVehicle, onOpenTripDetails }: FleetMapPanelProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState<FilterKey>('All');
    const debouncedSearch = useDebouncedValue(searchTerm);

    const filteredVehicles = useMemo(() => {
        const normalized = debouncedSearch.trim().toLowerCase();
        return vehicles.filter((vehicle) => {
            const status = getVehicleStatus(vehicle);
            const matchesFilter = (() => {
                switch (activeFilter) {
                    case 'Moving':
                        return status === 'moving';
                    case 'Idling':
                        return status === 'idling';
                    case 'Offline':
                        return status === 'offline';
                    case 'Alert':
                        return status === 'alert';
                    case 'No TO':
                        return !vehicle.current_travel_order;
                    case 'Maintenance Due':
                        return false;
                    default:
                        return true;
                }
            })();

            const haystack = [vehicle.plate_number, vehicle.driver_name, vehicle.current_travel_order].filter(Boolean).join(' ').toLowerCase();
            const matchesSearch = !normalized || haystack.includes(normalized);
            return matchesFilter && matchesSearch;
        });
    }, [activeFilter, debouncedSearch, vehicles]);

    const activityFeed = useMemo(() => {
        const entries = vehicles.flatMap((vehicle) => {
            const status = getVehicleStatus(vehicle);
            const base = {
                id: `${vehicle.vehicle_id}-${status}`,
                vehicle: vehicle.plate_number,
                driver: vehicle.driver_name || 'Unassigned',
                time: vehicle.last_seen || new Date().toISOString(),
                status,
                detail: status === 'moving' ? 'MOTION STARTED' : status === 'idling' ? 'IDLING TOO LONG' : status === 'offline' ? 'IGNITION OFF' : 'ALERT DETECTED',
            };
            return [base];
        });

        return entries
            .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, 20);
    }, [vehicles]);

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm transition-all hover:shadow-md">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                        <Search className="size-4 text-brand-teal" />
                        Search fleet operations
                    </div>
                    <div className="flex-1 lg:max-w-xl">
                        <label className="relative block">
                            <span className="sr-only">Search by plate, driver, or trip</span>
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                            <input
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Plate number, driver, or vehicle"
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-3 text-sm text-zinc-700 outline-none transition focus:border-brand-teal focus:bg-white"
                            />
                        </label>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {(['All', 'Moving', 'Idling', 'Offline', 'Alert', 'No TO', 'Maintenance Due'] as FilterKey[]).map((filter) => {
                        const selected = activeFilter === filter;
                        return (
                            <button
                                key={filter}
                                onClick={() => setActiveFilter(filter)}
                                className={cn(
                                    'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-all hover:-translate-y-0.5',
                                    selected ? 'bg-brand-teal text-white shadow-sm' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
                                )}
                            >
                                {filter}
                                <span className={cn('rounded-full px-2 py-0.5 text-[11px]', selected ? 'bg-white/20 text-white' : 'bg-white text-zinc-500')}>
                                    {getFilterCount(vehicles, filter)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[2fr,1fr]">
                <div className="rounded-2xl border border-zinc-100 bg-white p-3 shadow-sm transition-all hover:shadow-md">
                    <div className="mb-3 flex items-center justify-between px-2">
                        <div>
                            <p className="text-base font-bold text-zinc-900">Live Fleet Map</p>
                            <p className="text-sm text-zinc-500">Tap any vehicle for live status, trip context, and rapid actions.</p>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-brand-teal/10 px-3 py-1.5 text-sm font-semibold text-brand-teal">
                            <Sparkles className="size-4" />
                            Live
                        </div>
                    </div>
                    <MapView
                        vehicles={filteredVehicles}
                        selectedVehicleId={selectedVehicleId}
                        onSelectVehicle={onSelectVehicle}
                        onOpenTripDetails={onOpenTripDetails}
                    />
                </div>

                <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm transition-all hover:shadow-md">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <p className="text-base font-bold text-zinc-900">Recent GPS Events</p>
                            <p className="text-sm text-zinc-500">Newest events first · auto-refreshes with the fleet feed.</p>
                        </div>
                        <div className="rounded-full bg-brand-pastel/40 px-2.5 py-1 text-xs font-semibold text-brand-teal">{activityFeed.length} events</div>
                    </div>
                    <div className="space-y-2">
                        {activityFeed.length > 0 ? activityFeed.map((entry) => {
                            const meta = getStatusMeta(entry.status);
                            return (
                                <button
                                    key={entry.id}
                                    onClick={() => onSelectVehicle(vehicles.find((vehicle) => vehicle.plate_number === entry.vehicle)?.vehicle_id ?? null)}
                                    className="flex w-full items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-3 text-left transition-all hover:border-brand-teal/40 hover:bg-white hover:shadow-sm"
                                >
                                    <span className={cn('mt-0.5 size-2.5 rounded-full', meta.color)} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="truncate text-sm font-semibold text-zinc-900">{entry.vehicle}</p>
                                            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.badge)}>{meta.label}</span>
                                        </div>
                                        <p className="mt-1 text-sm font-medium text-zinc-700">{entry.detail}</p>
                                        <p className="mt-1 text-xs text-zinc-500">{entry.driver} · {formatDateTimeManila(entry.time)}</p>
                                    </div>
                                </button>
                            );
                        }) : (
                            <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
                                No live activity available yet.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface MapViewProps {
    vehicles: LiveMonitoringRow[];
    selectedVehicleId: string | null;
    onSelectVehicle: (vehicleId: string | null) => void;
    onOpenTripDetails: (tripId: string | null) => void;
}

function MapView({ vehicles, selectedVehicleId, onSelectVehicle, onOpenTripDetails }: MapViewProps) {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
    const markersRef = useRef<Map<string, L.Marker>>(new Map());

    useEffect(() => {
        if (!mapRef.current || mapInstanceRef.current) return;

        const map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: false,
            scrollWheelZoom: true,
        });

        map.setView([8.4542, 124.6319], 9);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19,
        }).addTo(map);

        const clusterGroup = L.markerClusterGroup({
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 14,
            removeOutsideVisibleBounds: true,
        });
        map.addLayer(clusterGroup);
        clusterGroupRef.current = clusterGroup;
        mapInstanceRef.current = map;

        return () => {
            map.remove();
            mapInstanceRef.current = null;
            clusterGroupRef.current = null;
            markersRef.current.clear();
        };
    }, []);

    useEffect(() => {
        const clusterGroup = clusterGroupRef.current;
        if (!clusterGroup) return;

        markersRef.current.forEach((marker) => {
            clusterGroup.removeLayer(marker);
        });
        markersRef.current.clear();

        const validVehicles = vehicles.filter((vehicle) => {
            const lat = Number(vehicle.latitude ?? (vehicle as any).lat);
            const lng = Number(vehicle.longitude ?? (vehicle as any).lng);
            return Number.isFinite(lat) && Number.isFinite(lng);
        });

        console.log('FleetMapPanel vehicles', vehicles);
        console.log('valid map vehicles', validVehicles);

        if (validVehicles.length === 0) return;

        validVehicles.forEach((vehicle) => {
            const lat = Number(vehicle.latitude ?? (vehicle as any).lat);
            const lng = Number(vehicle.longitude ?? (vehicle as any).lng);
            const status = getVehicleStatus(vehicle);
            const meta = getStatusMeta(status);
            const marker = L.marker([lat, lng]);

            const speed = status === 'moving' ? '42 km/h' : status === 'idling' ? '0 km/h' : '—';
            const googleMapsUrl = `https://www.google.com/maps?q=${vehicle.latitude},${vehicle.longitude}`;
            marker.bindPopup(`
        <div class="w-64 space-y-2 rounded-xl p-1 text-sm">
          <!-- Vehicle Photo Placeholder -->
          <div class="flex items-center justify-center bg-zinc-50 rounded-lg py-3 mb-2">
            <div class="flex size-12 items-center justify-center rounded-full bg-brand-teal/10">
              <svg class="size-6 text-brand-teal/60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.2 16 8 16 8s-1.2-1-3-1c-1.8 0-3 1-3 1s-2.7 2.2-4.5 3.1C4.7 11.3 4 12.1 4 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <div class="font-bold text-zinc-900 text-base">${vehicle.plate_number}</div>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.badge}">${meta.label}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-zinc-600">
            <div><span class="font-semibold text-zinc-700">Driver:</span> ${vehicle.driver_name || 'Unassigned'}</div>
            <div><span class="font-semibold text-zinc-700">Speed:</span> ${speed}</div>
            <div><span class="font-semibold text-zinc-700">TO:</span> ${vehicle.current_travel_order || '—'}</div>
            <div><span class="font-semibold text-zinc-700">GPS #:</span> ${vehicle.current_travel_order_id?.slice(0, 8) || '—'}</div>
            <div><span class="font-semibold text-zinc-700">Trip Type:</span> ${vehicle.current_travel_order ? 'Active trip' : 'No active trip'}</div>
            <div><span class="font-semibold text-zinc-700">Updated:</span> ${formatDateTimeManila(vehicle.last_seen)}</div>
          </div>
          <div class="text-xs text-zinc-600 mt-1"><span class="font-semibold text-zinc-700">Destination:</span> ${vehicle.destination || '—'}</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button data-action="trip-details" data-trip-id="${vehicle.current_travel_order_id || ''}" class="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-teal/90">
              View Trip
            </button>
            <button data-action="fleet-tracking" data-vehicle-id="${vehicle.vehicle_id}" class="inline-flex items-center gap-1.5 rounded-lg bg-brand-sage px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-sage/90" onclick="window.location.href='/gps-logs?tab=telemetry'">
              Fleet Tracking
            </button>
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
              Google Maps
            </a>
          </div>
        </div>
      `);

            marker.on('click', () => {
                onSelectVehicle(vehicle.vehicle_id);
            });

            marker.on('popupopen', () => {
                onSelectVehicle(vehicle.vehicle_id);
            });

            marker.on('popupopen', () => {
                const popup = marker.getPopup();
                if (popup) {
                    setTimeout(() => {
                        const tripButton = popup.getElement()?.querySelector('[data-action="trip-details"]') as HTMLButtonElement | null;
                        tripButton?.addEventListener('click', () => onOpenTripDetails(vehicle.current_travel_order_id || null));
                        const fleetButton = popup.getElement()?.querySelector('[data-action="fleet-tracking"]') as HTMLButtonElement | null;
                        fleetButton?.addEventListener('click', () => {
                            window.location.href = '/gps-logs?tab=telemetry';
                        });
                    }, 0);
                }
            });

            clusterGroup.addLayer(marker);
            markersRef.current.set(vehicle.vehicle_id, marker);
        });

        const bounds = L.latLngBounds(validVehicles.map((vehicle) => [vehicle.latitude as number, vehicle.longitude as number] as [number, number]));
        if (bounds.isValid() && mapInstanceRef.current) {
            mapInstanceRef.current.fitBounds(bounds, { padding: [45, 45] });
        }
    }, [onOpenTripDetails, onSelectVehicle, selectedVehicleId, vehicles]);

    return (
        <div className="relative">
            <div className="mb-3 flex items-center gap-2 px-2 text-sm text-zinc-500">
                <MapPin className="size-4 text-brand-teal" />
                {vehicles.length} vehicles shown · {vehicles.filter((vehicle) => getVehicleStatus(vehicle) === 'moving').length} moving
            </div>
            <div ref={mapRef} style={{ height: 420, width: '100%' }} className="overflow-hidden rounded-xl border border-zinc-100" />
        </div>
    );
}
