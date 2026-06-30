// ── Trip History Detail Modal ──────────────────────────────────
//
// Displays detailed information about a fleet trip history record
// with an interactive map centered on the GPS coordinate.

import { useEffect, useState } from 'react';
import { X, MapPin, Gauge, Fuel, Navigation, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { FleetTripHistoryRow } from '../api/gps-logs-api';

interface TripHistoryDetailModalProps {
  record: FleetTripHistoryRow | null;
  open: boolean;
  onClose: () => void;
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  Moving: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Idling: 'bg-amber-50 text-amber-700 border-amber-200',
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

export function TripHistoryDetailModal({ record, open, onClose }: TripHistoryDetailModalProps) {
  const [mapLoaded, setMapLoaded] = useState(false);

  // Reset map state when record changes
  useEffect(() => {
    if (open && record) {
      setMapLoaded(false);
    }
  }, [open, record]);

  if (!open || !record) return null;

  const hasCoordinates = record.latitude != null && record.longitude != null;
  const mapUrl = hasCoordinates
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${record.longitude! - 0.01}%2C${record.latitude! - 0.01}%2C${record.longitude! + 0.01}%2C${record.latitude! + 0.01}&layer=mapnik&marker=${record.latitude}%2C${record.longitude}`
    : null;

  const googleMapsUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${record.latitude},${record.longitude}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl bg-white px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-brand-teal/10 p-2">
              <Navigation className="size-5 text-brand-teal" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Trip History Detail</h2>
              <p className="text-xs text-zinc-400">{formatDateTime(record.event_time)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Status Badge */}
          <div className="flex items-center gap-3">
            <span className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium',
              STATUS_BADGE_COLORS[record.status] || 'bg-zinc-50 text-zinc-600',
            )}>
              {record.status}
            </span>
            {record.event && (
              <span className="text-sm text-zinc-500">{record.event}</span>
            )}
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Time</p>
              <p className="mt-1 text-sm text-zinc-800">{formatDateTime(record.event_time)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Status</p>
              <p className="mt-1 text-sm text-zinc-800">{record.status}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Event</p>
              <p className="mt-1 text-sm text-zinc-800">{record.event || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Road Speed</p>
              <p className="mt-1 text-sm text-zinc-800 flex items-center gap-1.5">
                <Gauge className="size-3.5 text-zinc-400" />
                {record.road_speed != null ? `${record.road_speed} km/h` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Fuel</p>
              <p className="mt-1 text-sm text-zinc-800 flex items-center gap-1.5">
                <Fuel className="size-3.5 text-zinc-400" />
                {record.fuel != null ? `${formatNumber(record.fuel)} L` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Location</p>
              <p className="mt-1 text-sm text-zinc-800 flex items-center gap-1.5">
                <MapPin className="size-3.5 text-zinc-400 shrink-0" />
                <span className="truncate">{record.location || '—'}</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Latitude</p>
              <p className="mt-1 text-sm font-mono text-zinc-800">{record.latitude != null ? formatNumber(record.latitude, 6) : '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Longitude</p>
              <p className="mt-1 text-sm font-mono text-zinc-800">{record.longitude != null ? formatNumber(record.longitude, 6) : '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</p>
              <p className="mt-1 text-sm text-zinc-800">
                {record.plate_number ? (
                  <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                    {record.plate_number}
                  </span>
                ) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Driver</p>
              <p className="mt-1 text-sm text-zinc-800">{record.driver_full_name || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Linked Travel Order</p>
              <p className="mt-1 text-sm text-zinc-800">
                {record.travel_order_to_number ? (
                  <span className="font-mono text-brand-teal font-medium">{record.travel_order_to_number}</span>
                ) : (
                  <span className="text-zinc-400">Not linked</span>
                )}
              </p>
            </div>
          </div>

          {/* Map */}
          {mapUrl && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Location Map</p>
                {googleMapsUrl && (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-teal hover:text-brand-teal/80 transition-colors"
                  >
                    <ExternalLink className="size-3" />
                    Open in Google Maps
                  </a>
                )}
              </div>
              <div className="relative rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50">
                {!mapLoaded && (
                  <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-2">
                      <div className="size-6 rounded-full border-2 border-brand-teal border-t-transparent animate-spin" />
                      <p className="text-xs text-zinc-400">Loading map...</p>
                    </div>
                  </div>
                )}
                <iframe
                  src={mapUrl}
                  width="100%"
                  height="300"
                  className={cn('border-0', mapLoaded ? 'block' : 'hidden')}
                  onLoad={() => setMapLoaded(true)}
                  title="Location Map"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </div>
          )}

          {!hasCoordinates && (
            <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-6 text-center">
              <MapPin className="size-8 text-zinc-300 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">No coordinates available for this record</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}