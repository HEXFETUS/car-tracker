import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { createGpsLog } from '../api/gps-logs-api';
import type { TripStatus } from '@car-tracker/shared';

interface AddGpsLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormErrors {
  gpsRecordNo?: string;
  tripDate?: string;
  vehicleId?: string;
  driverId?: string;
  originGpsStartPoint?: string;
  destinationGpsEndPoint?: string;
  tripStatusGps?: string;
}

const STATUS_OPTIONS: { value: TripStatus; label: string }[] = [
  { value: 'departed', label: 'Departed' },
  { value: 'en-route', label: 'En Route' },
  { value: 'arrived', label: 'Arrived' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'completed', label: 'Completed' },
];

export function AddGpsLogModal({ isOpen, onClose, onSuccess }: AddGpsLogModalProps) {
  const [gpsRecordNo, setGpsRecordNo] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [originGpsStartPoint, setOriginGpsStartPoint] = useState('');
  const [destinationGpsEndPoint, setDestinationGpsEndPoint] = useState('');
  const [actualRouteRoadTaken, setActualRouteRoadTaken] = useState('');
  const [departureTimeGps, setDepartureTimeGps] = useState('');
  const [arrivalTimeGps, setArrivalTimeGps] = useState('');
  const [gpsDistanceKm, setGpsDistanceKm] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [maxSpeedKph, setMaxSpeedKph] = useState('');
  const [tripStatusGps, setTripStatusGps] = useState<TripStatus>('departed');
  const [travelOrderId, setTravelOrderId] = useState('');
  const [anomalyFlag, setAnomalyFlag] = useState(false);
  const [notesRemarks, setNotesRemarks] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setGpsRecordNo('');
      setTripDate('');
      setVehicleId('');
      setDriverId('');
      setOriginGpsStartPoint('');
      setDestinationGpsEndPoint('');
      setActualRouteRoadTaken('');
      setDepartureTimeGps('');
      setArrivalTimeGps('');
      setGpsDistanceKm('');
      setEngineHours('');
      setMaxSpeedKph('');
      setTripStatusGps('departed');
      setTravelOrderId('');
      setAnomalyFlag(false);
      setNotesRemarks('');
      setErrors({});
      setSubmitError(null);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!gpsRecordNo.trim()) errs.gpsRecordNo = 'GPS Record No. is required';
    if (!tripDate) errs.tripDate = 'Trip date is required';
    if (!vehicleId.trim()) errs.vehicleId = 'Vehicle ID is required';
    if (!driverId.trim()) errs.driverId = 'Driver ID is required';
    if (!originGpsStartPoint.trim()) errs.originGpsStartPoint = 'Origin is required';
    if (!destinationGpsEndPoint.trim()) errs.destinationGpsEndPoint = 'Destination is required';
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      await createGpsLog({
        gpsRecordNo: gpsRecordNo.trim(),
        tripDate,
        vehicleId: vehicleId.trim(),
        driverId: driverId.trim(),
        originGpsStartPoint: originGpsStartPoint.trim(),
        destinationGpsEndPoint: destinationGpsEndPoint.trim(),
        actualRouteRoadTaken: actualRouteRoadTaken.trim() || '',
        departureTimeGps: departureTimeGps || '',
        arrivalTimeGps: arrivalTimeGps || '',
        gpsDistanceKm: Number(gpsDistanceKm) || 0,
        engineHours: Number(engineHours) || 0,
        maxSpeedKph: Number(maxSpeedKph) || 0,
        tripStatusGps,
        travelOrderId: travelOrderId.trim() || null,
        toStatusAuto: null,
        anomalyFlag,
        notesRemarks: notesRemarks.trim() || null,
      });
      onSuccess();
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to create GPS log');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm transition-opacity"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Import / Add GPS Log</h2>
            <p className="text-sm text-zinc-400">
              Enter the GPS tracking details from Cartrack Philippines.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {submitError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
              {submitError}
            </div>
          )}

          {/* GPS Record No. + Trip Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                GPS Record No. <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={gpsRecordNo}
                onChange={(e) => setGpsRecordNo(e.target.value)}
                placeholder="e.g. GPS-2026-0004"
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                  errors.gpsRecordNo ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.gpsRecordNo && (
                <p className="mt-1 text-xs text-red-500">{errors.gpsRecordNo}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Trip Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                  errors.tripDate ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.tripDate && (
                <p className="mt-1 text-xs text-red-500">{errors.tripDate}</p>
              )}
            </div>
          </div>

          {/* Vehicle ID + Driver ID */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Vehicle ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                placeholder="UUID of the vehicle"
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                  errors.vehicleId ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.vehicleId && (
                <p className="mt-1 text-xs text-red-500">{errors.vehicleId}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Driver ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                placeholder="UUID of the driver"
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                  errors.driverId ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.driverId && (
                <p className="mt-1 text-xs text-red-500">{errors.driverId}</p>
              )}
            </div>
          </div>

          {/* Origin + Destination */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Origin (GPS Start Point) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={originGpsStartPoint}
                onChange={(e) => setOriginGpsStartPoint(e.target.value)}
                placeholder="e.g. Makati City, NCR"
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                  errors.originGpsStartPoint ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.originGpsStartPoint && (
                <p className="mt-1 text-xs text-red-500">{errors.originGpsStartPoint}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Destination (GPS End Point) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={destinationGpsEndPoint}
                onChange={(e) => setDestinationGpsEndPoint(e.target.value)}
                placeholder="e.g. Clark Freeport, Pampanga"
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                  errors.destinationGpsEndPoint ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.destinationGpsEndPoint && (
                <p className="mt-1 text-xs text-red-500">{errors.destinationGpsEndPoint}</p>
              )}
            </div>
          </div>

          {/* Actual Route */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Actual Route / Road Taken <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              type="text"
              value={actualRouteRoadTaken}
              onChange={(e) => setActualRouteRoadTaken(e.target.value)}
              placeholder="e.g. NLEX → SCTEX → Dau Interchange"
              className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
            />
          </div>

          {/* Departure + Arrival Time */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Departure Time (GPS) <span className="text-zinc-400">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={departureTimeGps}
                onChange={(e) => setDepartureTimeGps(e.target.value)}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Arrival Time (GPS) <span className="text-zinc-400">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={arrivalTimeGps}
                onChange={(e) => setArrivalTimeGps(e.target.value)}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
            </div>
          </div>

          {/* Numeric fields row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                GPS Distance (km)
              </label>
              <input
                type="number"
                step="0.1"
                value={gpsDistanceKm}
                onChange={(e) => setGpsDistanceKm(e.target.value)}
                placeholder="0.0"
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Engine Hours
              </label>
              <input
                type="number"
                step="0.1"
                value={engineHours}
                onChange={(e) => setEngineHours(e.target.value)}
                placeholder="0.0"
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Max Speed (kph)
              </label>
              <input
                type="number"
                step="1"
                value={maxSpeedKph}
                onChange={(e) => setMaxSpeedKph(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
            </div>
          </div>

          {/* Trip Status + Travel Order + Anomaly */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Trip Status (GPS) <span className="text-red-500">*</span>
              </label>
              <select
                value={tripStatusGps}
                onChange={(e) => setTripStatusGps(e.target.value as TripStatus)}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal bg-white"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Linked TO No. <span className="text-zinc-400">(optional)</span>
              </label>
              <input
                type="text"
                value={travelOrderId}
                onChange={(e) => setTravelOrderId(e.target.value)}
                placeholder="e.g. TO-2026-0001"
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
            </div>
            <div>
              <label className="flex items-center gap-3 cursor-pointer select-none pt-6">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={anomalyFlag}
                    onChange={(e) => setAnomalyFlag(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={cn(
                      'h-6 w-11 rounded-full transition-colors',
                      anomalyFlag ? 'bg-red-500' : 'bg-zinc-200'
                    )}
                  >
                    <div
                      className={cn(
                        'size-5 rounded-full bg-white shadow-sm transition-transform',
                        anomalyFlag ? 'translate-x-[22px]' : 'translate-x-[2px]'
                      )}
                    />
                  </div>
                </div>
                <span className="text-sm font-medium text-zinc-700">Anomaly Flag</span>
              </label>
            </div>
          </div>

          {/* Notes / Remarks */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Notes / Remarks <span className="text-zinc-400">(optional)</span>
            </label>
            <textarea
              value={notesRemarks}
              onChange={(e) => setNotesRemarks(e.target.value)}
              rows={2}
              placeholder="Any additional notes or remarks..."
              className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none hover:ring-brand-teal"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
            >
              {submitting ? 'Saving...' : 'Add GPS Log'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}