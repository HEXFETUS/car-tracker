import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Navigation, MapPin, StickyNote } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/shared/lib/utils';
import { fetchTripDetails, updateGpsLogNotes, type TripDetailsResponse } from '../api/gps-logs-api';

// Fix Leaflet default marker icon issue
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

interface TripDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  logId: string | null;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

function TripStatusBadge({ status, anomalyFlag }: { status: string; anomalyFlag: boolean }) {
  if (anomalyFlag) {
    return (
      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
        Anomaly Detected
      </span>
    );
  }

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

export function TripDetailsModal({ isOpen, onClose, logId }: TripDetailsModalProps) {
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
      const result = await fetchTripDetails(logId);
      setData(result.data);
      setNotes(result.data.trip.notes ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trip details');
    } finally {
      setLoading(false);
    }
  }, [logId]);

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
      .bindPopup(`<b>Start</b><br/>${route[0].lat.toFixed(5)}, ${route[0].lng.toFixed(5)}<br/>${formatDateTime(route[0].timestamp)}`);

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
      .bindPopup(`<b>End</b><br/>${route[route.length - 1].lat.toFixed(5)}, ${route[route.length - 1].lng.toFixed(5)}<br/>${formatDateTime(route[route.length - 1].timestamp)}`);

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-6 pb-6">
      <div className="relative w-[90vw] max-w-5xl rounded-xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-6 py-4">
          <div className="flex items-center gap-3">
            <Navigation className="size-5 text-brand-teal" />
            <div>
              <h2 className="text-lg font-bold text-zinc-800">Trip Details</h2>
              {trip && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  {trip.vehicle} — {trip.driver}
                </p>
              )}
            </div>
            {trip && (
              <div className="ml-4">
                <TripStatusBadge status={trip.status} anomalyFlag={trip.anomalyFlag} />
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
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
            <p className="text-sm font-medium text-zinc-500">Loading trip details...</p>
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
                <h3 className="text-sm font-semibold text-zinc-700 mb-3">Trip Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <InfoField label="Origin (GPS Start)" value={trip.origin || '—'} />
                  <InfoField label="Destination (GPS End)" value={trip.destination || '—'} />
                  <InfoField label="Route / Road Taken" value={trip.routeRoadTaken || 'GPS Route Available'} />
                  <InfoField label="Distance (km)" value={formatNumber(trip.distance, 1)} />
                  <InfoField label="Engine Hours" value={formatNumber(trip.engineHours, 1)} />
                  <InfoField label="Moving Hours" value={formatNumber(trip.movingHours, 1)} />
                  <InfoField label="Max Speed" value={trip.maxSpeed != null ? `${formatNumber(trip.maxSpeed, 0)} kph` : '—'} />
                  <InfoField
                    label="Date"
                    value={trip.date ? formatDateTime(trip.date) : formatDateTime(trip.departureTime)}
                  />
                  <InfoField label="Departed" value={formatDateTime(trip.departureTime)} />
                  <InfoField label="Arrived" value={formatDateTime(trip.arrivalTime)} />
                  <InfoField label="Linked TO" value={trip.linkedTO || '—'} />
                  <InfoField label="TO Status" value={trip.toStatus || '—'} />
                  {trip.coordinatesOrigin && (
                    <InfoField label="Start Coordinates" value={trip.coordinatesOrigin} />
                  )}
                  {trip.coordinatesDestination && (
                    <InfoField label="End Coordinates" value={trip.coordinatesDestination} />
                  )}
                </div>

                {/* Editable Notes */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Notes</h4>
                    <button
                      onClick={handleSaveNotes}
                      disabled={notesSaving}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        notesSaving
                          ? 'text-zinc-400 cursor-not-allowed'
                          : 'text-brand-teal hover:bg-brand-teal/5',
                      )}
                    >
                      {notesSaving ? (
                        <><Loader2 className="size-3 animate-spin" /> Saving…</>
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

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="text-sm text-zinc-700 mt-0.5 break-words">{value}</span>
    </div>
  );
}