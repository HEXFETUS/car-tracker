import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  X,
  Navigation,
  MapPin,
  StickyNote,
  CircleDot,
  Flag,
  BarChart3,
  Route,
  Gauge,
  Clock3,
  Timer,
  Link2,
  ClipboardCheck,
  MapPinned,
  Activity,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/shared/lib/utils';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import { fetchNoToTripDetails, fetchTripDetails, updateGpsLogNotes, type TripDetailsResponse } from '../api/gps-logs-api';

// Fix Leaflet default marker icon issue
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

interface TripDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTrip?: (id: string) => void;
  logId: string | null;
  source?: 'to' | 'no-to';
}

function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

function TripStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    completed: { label: 'Trip Completed', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    arrived: { label: 'Trip Completed', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    'en-route': { label: 'Ongoing', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    departed: { label: 'Ongoing', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    cancelled: { label: 'Cancelled', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
  };

  const match = config[status];
  if (match) {
    return (
      <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold', match.className)}>
        {match.label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-500">
      {status.replace('-', ' ')}
    </span>
  );
}

function TripDirectionBadge({ tripType }: { tripType: string | null | undefined }) {
  const isReturn = String(tripType ?? '').toUpperCase() === 'RETURN';
  const Icon = isReturn ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold',
      isReturn
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-orange-200 bg-orange-50 text-orange-700',
    )}>
      <Icon className="size-3.5" />
      {isReturn ? 'Return Trip' : 'Outbound Trip'}
    </span>
  );
}

function AnomalyBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
      No TO
    </span>
  );
}

export function TripDetailsModal({ isOpen, onClose, onOpenTrip, logId, source = 'to' }: TripDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TripDetailsResponse['data'] | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  const loadDetails = useCallback(async () => {
    if (!logId) return;
    try {
      setLoading(true);
      setError(null);
      const result = source === 'no-to' ? await fetchNoToTripDetails(logId) : await fetchTripDetails(logId);
      setData(result.data);
      setNotes(result.data.trip.notes ?? '');
      console.log('[TripDetailsModal] Trip data:', result.data.trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trip details');
    } finally {
      setLoading(false);
    }
  }, [logId, source]);

  useEffect(() => {
    if (isOpen && logId) {
      loadDetails();
    } else {
      setData(null);
      setError(null);
      setNotes('');
    }
  }, [isOpen, logId, loadDetails]);

  // Initialize map when data is loaded
  useEffect(() => {
    if (!data || !mapRef.current || mapInstanceRef.current) return;

    const route = data.route;
    if (route.length === 0) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Draw polyline
    const latLngs = route.map((p) => [p.lat, p.lng] as [number, number]);
    const polyline = L.polyline(latLngs, {
      color: '#0d9488',
      weight: 4,
      opacity: 0.8,
    }).addTo(map);

    // Start marker (green)
    const start = latLngs[0];
    L.circleMarker(start, {
      radius: 8,
      fillColor: '#22c55e',
      color: '#166534',
      weight: 2,
      opacity: 1,
      fillOpacity: 1,
    })
      .addTo(map)
      .bindPopup(`<b>Start</b><br/>${route[0].lat.toFixed(5)}, ${route[0].lng.toFixed(5)}<br/>${formatDateTimeManila(route[0].timestamp)}`);

    // End marker (red)
    const end = latLngs[latLngs.length - 1];
    L.circleMarker(end, {
      radius: 8,
      fillColor: '#ef4444',
      color: '#991b1b',
      weight: 2,
      opacity: 1,
      fillOpacity: 1,
    })
      .addTo(map)
      .bindPopup(`<b>End</b><br/>${route[route.length - 1].lat.toFixed(5)}, ${route[route.length - 1].lng.toFixed(5)}<br/>${formatDateTimeManila(route[route.length - 1].timestamp)}`);

    // Fit bounds
    const bounds = polyline.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [data]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const handleSaveNotes = async () => {
    if (!logId) return;
    try {
      setNotesSaving(true);
      await updateGpsLogNotes(logId, notes || null);
      // Reload to confirm saved state
      await loadDetails();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setNotesSaving(false);
    }
  };

  if (!isOpen) return null;

  const trip = data?.trip;

  // Compute display status for the modal badge
  const modalStatus =
    trip?.status === 'completed' ||
      trip?.status === 'arrived' ||
      (trip?.startTime && trip?.arrivedTime)
      ? 'Completed'
      : trip?.status === 'cancelled'
        ? 'Cancelled'
        : trip?.status === 'en-route' || trip?.status === 'departed' || trip?.status === 'ongoing' || trip?.status === 'tracking_started'
          ? 'Ongoing'
          : 'Pending';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-6 pb-6">
      <div className="relative w-[90vw] max-w-5xl rounded-xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-6 py-4">
          <div className="flex items-center gap-3">
            <Navigation className="size-5 text-brand-teal" />
            <div>
              <h2 className="text-lg font-bold text-zinc-800">{source === 'no-to' ? 'No TO Details' : 'Trip Details'}</h2>
              {trip && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  {trip.vehicle} — {trip.driver}
                </p>
              )}
            </div>
            {trip && (
              <div className="ml-4 flex flex-wrap items-center gap-2">
                <TripDirectionBadge tripType={trip.tripType} />
                <TripStatusBadge status={modalStatus} />
                <AnomalyBadge show={trip.anomalyFlag && !trip.linkedTO} />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-4 px-6 py-10">
            <div className="h-56 animate-pulse rounded-xl bg-zinc-100" />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
              <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <p className="text-sm font-medium text-red-500">{error}</p>
            <button
              onClick={loadDetails}
              className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && data && (
          <div className="px-6 py-5 space-y-6">
            {/* Interactive Map */}
            {data.route.length > 0 ? (
              <div className="rounded-xl overflow-hidden border border-zinc-200">
                <div ref={mapRef} className="h-[400px] w-full" />
                <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block size-2.5 rounded-full bg-green-500 ring-1 ring-green-700" /> Start
                  </span>
                  <span>{data.route.length} GPS points</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block size-2.5 rounded-full bg-red-500 ring-1 ring-red-700" /> End
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12">
                <MapPin className="size-8 text-zinc-300 mb-2" />
                <p className="text-sm font-medium text-zinc-500">No GPS route available.</p>
                <p className="text-xs text-zinc-400 mt-1">No telemetry data points found for this trip.</p>
              </div>
            )}

            {/* Trip Information Grid */}
            {trip && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-800">Trip Information</h3>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {data.routeCount} GPS points
                  </span>
                </div>
                <div className="space-y-5">
                  <InfoSection title="Origin" icon={<CircleDot className="size-4 text-emerald-600" />}>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <InfoField label="Address" value={trip.origin || '—'} />
                      <InfoField label="Start Time" value={formatDateTimeManila(trip.startTime)} />
                      <InfoField label="Start Coordinates" value={trip.coordinatesOrigin || '—'} />
                    </div>
                  </InfoSection>

                  <InfoSection title="Arrival" icon={<Flag className="size-4 text-red-600" />}>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <InfoField label="Destination Address" value={trip.plannedDestinationAddress || trip.toDestination || trip.destination || '—'} />
                      <InfoField label="Arrived Time" value={source === 'no-to' ? formatDateTimeManila(trip.arrivalDisplayTime ?? null) : formatDateTimeManila(trip.arrivedTime)} />
                      <InfoField label="Destination Coordinates" value={trip.plannedDestinationCoordinates || '—'} />
                      {source !== 'no-to' && (
                        <>
                          <InfoField label="Arrived Location" value={trip.arrivedLocation || '—'} />
                          <InfoField label="Arrived Coordinates" value={trip.arrivedCoordinates || '—'} />
                          <InfoField label="Matched Distance" value={trip.matchedDestinationDistanceM != null ? `${formatNumber(trip.matchedDestinationDistanceM, 0)} m` : '—'} />
                        </>
                      )}
                    </div>
                  </InfoSection>

                  <InfoSection title="End" icon={<MapPin className="size-4 text-brand-teal" />}>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <InfoField label="End Address" value={trip.endAddress || trip.destination || '—'} />
                      <InfoField label="End Time" value={source === 'no-to' ? formatDateTimeManila(trip.endTime ?? trip.returnedToBaseAt) : formatDateTimeManila(trip.returnedToBaseAt || trip.endTime)} />
                      <InfoField label="End Coordinates" value={trip.endCoordinates || trip.coordinatesDestination || '—'} />
                      {source !== 'no-to' && (
                        <InfoField label="Returned to Base Distance" value={trip.matchedOriginDistanceM != null ? `${formatNumber(trip.matchedOriginDistanceM, 0)} m` : '—'} />
                      )}
                    </div>
                  </InfoSection>

                  <InfoSection title="Trip Summary" icon={<BarChart3 className="size-4 text-brand-teal" />}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricTile icon={<Route className="size-4" />} label="Route Taken" value={trip.routeRoadTaken || 'GPS Route Available'} />
                      <MetricTile icon={<MapPinned className="size-4" />} label="Distance" value={trip.distance != null ? `${formatNumber(trip.distance, 1)} km` : '—'} />
                      <MetricTile icon={<Timer className="size-4" />} label="Engine Hours" value={trip.engineHours != null ? `${formatNumber(trip.engineHours, 1)} hrs` : '—'} />
                      <MetricTile icon={<Clock3 className="size-4" />} label="Moving Hours" value={trip.movingHours != null ? `${formatNumber(trip.movingHours, 1)} hrs` : '—'} />
                      <MetricTile icon={<Gauge className="size-4" />} label="Max Speed" value={trip.maxSpeed != null ? `${formatNumber(trip.maxSpeed, 0)} kph` : '—'} />
                      {source !== 'no-to' && (
                        <>
                          <MetricTile icon={<Link2 className="size-4" />} label="Linked TO" value={trip.linkedTO || '—'} />
                          <MetricTile icon={<ClipboardCheck className="size-4" />} label="TO Status" value={trip.travelOrderStatus || trip.toStatus || '—'} />
                        </>
                      )}
                    </div>
                  </InfoSection>
                  {source !== 'no-to' && trip.anomalyReason && (
                    <InfoSection title="Anomaly" icon={<Activity className="size-4 text-red-600" />}>
                      <InfoField label="Reason" value={trip.anomalyReason} />
                    </InfoSection>
                  )}
                  {source !== 'no-to' && (
                    <InfoSection title="Linked Trip" icon={<Navigation className="size-4 text-brand-teal" />}>
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Linked Trip</p>
                          <p className="mt-2 text-sm font-semibold text-zinc-800">{trip.missionDisplay || 'Standalone'}</p>
                        </div>
                        {trip.linkedOutboundTrip && (
                          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Linked Trip</p>
                                <p className="mt-2 text-sm font-semibold text-zinc-800">{trip.linkedOutboundTrip.gpsRecordNo} (Outbound)</p>
                              </div>
                              {onOpenTrip && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenTrip(trip.linkedOutboundTrip!.id);
                                  }}
                                  className="rounded-lg border border-brand-teal bg-brand-teal/5 px-3 py-2 text-xs font-semibold text-brand-teal hover:bg-brand-teal/10 transition-colors"
                                >
                                  View Details
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {trip.linkedReturnTrip && (
                          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Linked Trip</p>
                                <p className="mt-2 text-sm font-semibold text-zinc-800">{trip.linkedReturnTrip.gpsRecordNo} (Return)</p>
                              </div>
                              {onOpenTrip && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenTrip(trip.linkedReturnTrip!.id);
                                  }}
                                  className="rounded-lg border border-brand-teal bg-brand-teal/5 px-3 py-2 text-xs font-semibold text-brand-teal hover:bg-brand-teal/10 transition-colors"
                                >
                                  View Details
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </InfoSection>
                  )}
                </div>

                {/* Editable Notes */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Notes</h4>
                    <button
                      onClick={handleSaveNotes}
                      disabled={notesSaving || !notes.trim()}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        notesSaving || !notes.trim()
                          ? 'text-zinc-400 cursor-not-allowed'
                          : 'text-brand-teal hover:bg-brand-teal/5',
                      )}
                    >
                      {notesSaving ? (
                        <>Saving…</>
                      ) : (
                        <><StickyNote className="size-3.5" /> Save Notes</>
                      )}
                    </button>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm resize-none leading-relaxed placeholder:text-zinc-300"
                    placeholder="Add notes or remarks about this trip..."
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-zinc-100 bg-white rounded-b-xl px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-5 shadow-md shadow-zinc-200/50">
      <div className="mb-5 flex items-center gap-3 border-b border-zinc-200 pb-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
          {icon}
        </span>
        <h4 className="text-base font-semibold text-zinc-800">{title}</h4>
      </div>
      {children}
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="mt-1 break-words text-[15px] font-medium leading-snug text-zinc-800">{value}</span>
    </div>
  );
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-h-[92px] rounded-xl border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-zinc-500">
        <span className="flex size-7 items-center justify-center rounded-lg bg-zinc-100 text-brand-teal">
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="break-words text-[15px] font-semibold leading-snug text-zinc-800">{value}</div>
    </div>
  );
}