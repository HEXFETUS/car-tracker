import { useState, useRef, useEffect } from 'react';
import { X, Upload } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useAuth } from '@/modules/auth/context/auth-context';
import { fetchNextToNumber } from '../api/travel-orders-api';
import { PlaceSearchInput } from './PlaceSearchInput';
import { PinpointMapModal } from './PinpointMapModal';
import type { TravelOrder } from '../types';

interface NewTravelOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (order: TravelOrder) => void;
  existingCount: number;
}

interface FormErrors {
  department?: string;
  travelerName?: string;
  departureDateTime?: string;
  returnDateTime?: string;
  boundFrom?: string;
  boundTo?: string;
  purpose?: string;
}

type MapTarget = 'origin' | 'destination';

function generateToNumber(seq: number): string {
  const year = new Date().getFullYear();
  return `TO-${year}-${String(seq).padStart(4, '0')}`;
}

function getCurrentDatetimeLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function NewTravelOrderModal({
  isOpen,
  onClose,
  onSubmit,
  existingCount,
}: NewTravelOrderModalProps) {
  const { user } = useAuth();
  const [department, setDepartment] = useState('');
  const [travelerName, setTravelerName] = useState('');
  const [departureDateTime, setDepartureDateTime] = useState('');
  const [returnDateTime, setReturnDateTime] = useState('');
  const [boundFrom, setBoundFrom] = useState('VLC Tower 1');
  const [boundTo, setBoundTo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [requestVehicle, setRequestVehicle] = useState(false);
  const [requestDriver, setRequestDriver] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isDragging, setIsDragging] = useState(false);

  // Lat/Lng state
  const [latLongOrigin, setLatLongOrigin] = useState<string | null>(null);
  const [latLongDestination, setLatLongDestination] = useState<string | null>(null);

  // Track whether location was pinpointed via the map (hides "Show on Map" footer)
  const [originPinpointed, setOriginPinpointed] = useState(false);
  const [destPinpointed, setDestPinpointed] = useState(false);

  // Map modal state
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapTarget, setMapTarget] = useState<MapTarget>('origin');
  const [mapInitialQuery, setMapInitialQuery] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Next TO number state (fetched from API)
  const [nextSeq, setNextSeq] = useState<number>(1);
  const toNumber = generateToNumber(nextSeq);
  const [dateIssued, setDateIssued] = useState(new Date().toISOString().slice(0, 10));
  const canEditDateIssued = user?.userType === 'SUPERADMIN';

  // Fetch next TO number and reset form on open
  useEffect(() => {
    if (isOpen) {
      setDepartment('');
      setTravelerName('');
      setDepartureDateTime(getCurrentDatetimeLocal());
      setReturnDateTime(getCurrentDatetimeLocal());
      setBoundFrom('VLC Tower 1');
      setBoundTo('');
      setPurpose('');
      setRequestVehicle(false);
      setRequestDriver(false);
      setRemarks('');
      setImageData(null);
      setImageName('');
      setErrors({});
      setDateIssued(new Date().toISOString().slice(0, 10));
      setLatLongOrigin(null);
      setLatLongDestination(null);
      setOriginPinpointed(false);
      setDestPinpointed(false);

      // Fetch the next TO number from the DB
      fetchNextToNumber()
        .then((seq) => setNextSeq(seq))
        .catch(() => {
          // Fallback: use existingCount + 1 if API fails
          setNextSeq(existingCount + 1);
        });
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

  // Close on backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === modalRef.current) onClose();
  }

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!department.trim()) errs.department = 'Department is required';
    if (!travelerName.trim()) errs.travelerName = 'Traveler name is required';
    if (!departureDateTime) errs.departureDateTime = 'Departure date & time is required';
    if (!returnDateTime) errs.returnDateTime = 'Return date & time is required';
    if (!boundFrom.trim()) errs.boundFrom = 'Origin is required';
    if (!boundTo.trim()) errs.boundTo = 'Destination is required';
    if (!purpose.trim()) errs.purpose = 'Purpose of travel is required';
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const order: TravelOrder = {
      toNumber,
      dateIssued,
      department: department.trim(),
      travelerName: travelerName.trim(),
      departureDateTime,
      returnDateTime,
      boundFrom: boundFrom.trim(),
      boundTo: boundTo.trim(),
      purpose: purpose.trim(),
      requestVehicle,
      requestDriver,
      remarks: remarks.trim() || undefined,
      imageAttachment: imageData,
      status: 'pending',
      latLongOrigin,
      latLongDestination,
    };

    onSubmit(order);
  }

  function handleFileSelect(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setImageData(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files[0]);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function removeImage() {
    setImageData(null);
    setImageName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleSelectOriginLocation(placeName: string, lat: string, lng: string) {
    setBoundFrom(placeName);
    setLatLongOrigin(`${lat},${lng}`);
  }

  function handleSelectDestinationLocation(placeName: string, lat: string, lng: string) {
    setBoundTo(placeName);
    setLatLongDestination(`${lat},${lng}`);
  }

  function openMapFor(target: MapTarget, currentQuery: string) {
    setMapTarget(target);
    setMapInitialQuery(currentQuery || target === 'origin' ? boundFrom : boundTo);
    setIsMapOpen(true);
  }

  function handleMapConfirm(lat: string, lng: string, address: string) {
    if (mapTarget === 'origin') {
      setBoundFrom(address);
      setLatLongOrigin(`${lat},${lng}`);
      setOriginPinpointed(true);
    } else {
      setBoundTo(address);
      setLatLongDestination(`${lat},${lng}`);
      setDestPinpointed(true);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-0 sm:py-10 backdrop-blur-sm transition-opacity"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-2xl min-h-screen sm:min-h-0 animate-in fade-in zoom-in-95 rounded-none sm:rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">New Travel Order</h2>
            <p className="text-sm text-zinc-400">
              Fill in the details to create a new travel order request.
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
          {/* Row: TO Number + Date Issued */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* TO Number (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                TO Number
              </label>
              <input
                type="text"
                value={toNumber}
                readOnly
                className="w-full rounded-lg bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-500 cursor-not-allowed"
              />
            </div>
            {/* Date Issued (Editable for SUPERADMIN only) */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Date Issued <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={dateIssued}
                onChange={(e) => setDateIssued(e.target.value)}
                disabled={!canEditDateIssued}
                className={cn(
                  'w-full rounded-lg px-3.5 py-2.5 text-sm',
                  canEditDateIssued
                    ? 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow'
                    : 'bg-zinc-50 text-zinc-500 cursor-not-allowed'
                )}
              />
            </div>
          </div>

          {/* Row: Department + Traveler */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Requesting Office / Dept <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. HR Department"
                  className={cn(
                    'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                    errors.department ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                  )}
              />
              {errors.department && (
                <p className="mt-1 text-xs text-red-500">{errors.department}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Traveler / Personnel <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={travelerName}
                onChange={(e) => setTravelerName(e.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                  className={cn(
                    'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                    errors.travelerName ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                  )}
              />
              {errors.travelerName && (
                <p className="mt-1 text-xs text-red-500">{errors.travelerName}</p>
              )}
            </div>
          </div>

          {/* Row: Departure + Return Date/Time */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Departure Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={departureDateTime}
                onChange={(e) => setDepartureDateTime(e.target.value)}
                  className={cn(
                    'w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                    errors.departureDateTime ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                  )}
              />
              {errors.departureDateTime && (
                <p className="mt-1 text-xs text-red-500">{errors.departureDateTime}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Return Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={returnDateTime}
                onChange={(e) => setReturnDateTime(e.target.value)}
                  className={cn(
                    'w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
                    errors.returnDateTime ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                  )}
              />
              {errors.returnDateTime && (
                <p className="mt-1 text-xs text-red-500">{errors.returnDateTime}</p>
              )}
            </div>
          </div>

          {/* Row: Bound From + Bound To */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Bound From <span className="text-red-500">*</span>
              </label>
              <PlaceSearchInput
                value={boundFrom}
                onChange={setBoundFrom}
                onSelectLocation={handleSelectOriginLocation}
                placeholder="e.g. Manila"
                error={errors.boundFrom}
                mapLabel="Show on Map to set exact location"
                onShowOnMap={() => openMapFor('origin', boundFrom)}
                hideShowOnMap={originPinpointed}
              />
              {latLongOrigin && (
                <p className="mt-1 text-xs text-zinc-400">
                  Coordinates: {latLongOrigin}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Bound To <span className="text-red-500">*</span>
              </label>
              <PlaceSearchInput
                value={boundTo}
                onChange={setBoundTo}
                onSelectLocation={handleSelectDestinationLocation}
                placeholder="e.g. Cebu"
                error={errors.boundTo}
                mapLabel="Show on Map to set exact location"
                onShowOnMap={() => openMapFor('destination', boundTo)}
                hideShowOnMap={destPinpointed}
              />
              {latLongDestination && (
                <p className="mt-1 text-xs text-zinc-400">
                  Coordinates: {latLongDestination}
                </p>
              )}
            </div>
          </div>

          {/* Purpose of Travel */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Purpose of Travel <span className="text-red-500">*</span>
            </label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              placeholder="Briefly describe the purpose of this travel..."
                  className={cn(
                    'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none',
                    errors.purpose ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                  )}
            />
            {errors.purpose && (
              <p className="mt-1 text-xs text-red-500">{errors.purpose}</p>
            )}
          </div>

          {/* Toggle switches row */}
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={requestVehicle}
                  onChange={(e) => setRequestVehicle(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={cn(
                    'h-6 w-11 rounded-full transition-colors',
                    requestVehicle ? 'bg-brand-teal' : 'bg-zinc-200'
                  )}
                >
                  <div
                    className={cn(
                      'size-5 rounded-full bg-white shadow-sm transition-transform',
                      requestVehicle ? 'translate-x-[22px]' : 'translate-x-[2px]'
                    )}
                  />
                </div>
              </div>
              <span className="text-sm font-medium text-zinc-700">Request Vehicle</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={requestDriver}
                  onChange={(e) => setRequestDriver(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={cn(
                    'h-6 w-11 rounded-full transition-colors',
                    requestDriver ? 'bg-brand-teal' : 'bg-zinc-200'
                  )}
                >
                  <div
                    className={cn(
                      'size-5 rounded-full bg-white shadow-sm transition-transform',
                      requestDriver ? 'translate-x-[22px]' : 'translate-x-[2px]'
                    )}
                  />
                </div>
              </div>
              <span className="text-sm font-medium text-zinc-700">Request Driver</span>
            </label>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Remarks <span className="text-zinc-400">(optional)</span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="Any additional notes..."
              className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none hover:ring-brand-teal"
            />
          </div>

          {/* Attach Picture */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Attach Picture <span className="text-zinc-400">(optional)</span>
            </label>
            {imageData ? (
            <div className="relative overflow-hidden rounded-lg ring-1 ring-brand-sage">
                <img
                  src={imageData}
                  alt={imageName || 'Uploaded preview'}
                  className="h-48 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="size-4" />
                </button>
                <p className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
                  {imageName}
                </p>
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 transition-colors',
                  isDragging
                    ? 'border-brand-teal bg-brand-cream'
                    : 'border-brand-sage hover:border-brand-teal hover:bg-brand-cream'
                )}
              >
                <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-brand-moss/30">
                  <Upload className="size-5 text-brand-teal" />
                </div>
                <p className="text-sm font-medium text-zinc-600">
                  Click to upload or drag and drop
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">PNG, JPG, GIF up to 10MB</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors"
            >
              Create Travel Order
            </button>
          </div>
        </form>
      </div>

      {/* Pinpoint Map Modal */}
      <PinpointMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        onConfirm={handleMapConfirm}
        initialQuery={mapInitialQuery}
        locationLabel={mapTarget === 'origin' ? 'Bound From (Origin)' : 'Bound To (Destination)'}
      />
    </div>
  );
}
