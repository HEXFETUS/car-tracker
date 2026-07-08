import { useState, useEffect, useRef, useMemo } from 'react';
import { X, ChevronDown, Check, Upload, Wrench } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { fetchVehicles } from '@/modules/list/api/vehicles-api';
import type { Vehicle } from '@car-tracker/shared';

interface MaintenanceFormData {
  vehicleId: string;
  serviceType: string;
  cost: number;
  date: string;
  remarks?: string;
  receiptNumber?: string;
  attachedPicture?: string | undefined;
}

interface NewMaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: MaintenanceFormData) => void;
  initialRecord?: MaintenanceFormData & { id: string };
}

interface FormErrors {
  vehicleId?: string;
  serviceType?: string;
  cost?: string;
  date?: string;
}

export function NewMaintenanceModal({ isOpen, onClose, onSubmit, initialRecord }: NewMaintenanceModalProps) {
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const [serviceType, setServiceType] = useState('');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [attachedPicture, setAttachedPicture] = useState<string | null>(null);
  const [attachedPictureName, setAttachedPictureName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load vehicles on open
  useEffect(() => {
    if (isOpen && vehicles.length === 0) {
      setVehiclesLoading(true);
      fetchVehicles()
        .then(setVehicles)
        .catch(() => { })
        .finally(() => setVehiclesLoading(false));
    }
  }, [isOpen, vehicles.length]);

  // Reset form on open, pre-fill if editing
  useEffect(() => {
    if (isOpen) {
      if (initialRecord) {
        setVehicleId(initialRecord.vehicleId);
        setVehicleSearch('');
        setServiceType(initialRecord.serviceType);
        setCost(String(initialRecord.cost));
        setDate(initialRecord.date);
        setReceiptNumber(initialRecord.receiptNumber ?? '');
        setAttachedPicture(initialRecord.attachedPicture ?? null);
        setAttachedPictureName('');
        setRemarks(initialRecord.remarks ?? '');
        setErrors({});
        setShowVehicleDropdown(false);
      } else {
        setVehicleId('');
        setVehicleSearch('');
        setServiceType('');
        setCost('');
        setDate('');
        setReceiptNumber('');
        setAttachedPicture(null);
        setAttachedPictureName('');
        setRemarks('');
        setErrors({});
        setShowVehicleDropdown(false);
      }
    }
  }, [isOpen, initialRecord]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === vehicleId),
    [vehicles, vehicleId],
  );

  useEffect(() => {
    if (selectedVehicle && vehicleId && !vehicleSearch) {
      setVehicleSearch(`${selectedVehicle.plateNumber} — ${selectedVehicle.make} ${selectedVehicle.model}`);
    }
  }, [selectedVehicle, vehicleId, vehicleSearch]);

  const filteredVehicles = useMemo(
    () =>
      vehicles.filter((v) => {
        const q = vehicleSearch.toLowerCase();
        return (
          v.plateNumber.toLowerCase().includes(q) ||
          v.make.toLowerCase().includes(q) ||
          v.model.toLowerCase().includes(q)
        );
      }),
    [vehicles, vehicleSearch],
  );

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowVehicleDropdown(false);
        if (!vehicleId) {
          // keep what they typed
        } else if (selectedVehicle) {
          setVehicleSearch(`${selectedVehicle.plateNumber} — ${selectedVehicle.make} ${selectedVehicle.model}`);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [vehicleId, selectedVehicle]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function handleVehicleSelect(vehicle: Vehicle) {
    setVehicleId(vehicle.id);
    setVehicleSearch(`${vehicle.plateNumber} — ${vehicle.make} ${vehicle.model}`);
    setShowVehicleDropdown(false);
  }

  function handleSearchChange(value: string) {
    setVehicleSearch(value);
    if (vehicleId) {
      setVehicleId('');
    }
    setShowVehicleDropdown(true);
  }

  function handleFileSelect(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      setPictureError('Image size must be less than 10MB');
      setAttachedPicture(null);
      setAttachedPictureName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setPictureError(null);
    setAttachedPictureName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setAttachedPicture(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!vehicleId) errs.vehicleId = 'Please select a vehicle';
    if (!serviceType.trim()) errs.serviceType = 'Service type is required';
    if (!cost.trim()) {
      errs.cost = 'Cost is required';
    } else {
      const c = Number(cost);
      if (isNaN(c) || c < 0) errs.cost = 'Enter a valid cost';
    }
    if (!date.trim()) errs.date = 'Date is required';
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    onSubmit({
      vehicleId,
      serviceType: serviceType.trim(),
      cost: Number(cost),
      date: date.trim(),
      remarks: remarks.trim() || undefined,
      receiptNumber: receiptNumber.trim() || undefined,
      attachedPicture: attachedPicture || undefined,
    });
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-brand-teal/20">
              <Wrench className="size-5 text-brand-teal" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">
                {initialRecord ? 'Edit Maintenance' : 'Add New Maintenance'}
              </h2>
              <p className="text-sm text-zinc-500">
                {initialRecord ? 'Update the maintenance service details.' : 'Record a new maintenance service details.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-white/60 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {/* Vehicle (searchable combobox) */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Vehicle <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={vehicleSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setShowVehicleDropdown(true)}
                placeholder={vehiclesLoading ? 'Loading vehicles...' : 'Search by plate, make, or model...'}
                disabled={vehiclesLoading}
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 pr-10 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-all',
                  errors.vehicleId ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
            </div>
            {errors.vehicleId && (
              <p className="mt-1.5 text-xs text-red-500">{errors.vehicleId}</p>
            )}

            {/* Dropdown */}
            {showVehicleDropdown && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg max-h-60 overflow-y-auto">
                {filteredVehicles.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-zinc-400">
                    {vehiclesLoading ? 'Loading...' : 'No vehicles found'}
                  </div>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => handleVehicleSelect(vehicle)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-brand-cream',
                        vehicle.id === vehicleId ? 'bg-brand-cream font-medium' : ''
                      )}
                    >
                      <span className="flex-1">
                        <span className="text-zinc-900">{vehicle.plateNumber}</span>
                        <span className="text-zinc-400 ml-2">
                          {vehicle.make} {vehicle.model} ({vehicle.year})
                        </span>
                      </span>
                      {vehicle.id === vehicleId && (
                        <Check className="size-4 text-brand-teal shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Row: Service Type + Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Service Type <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="e.g. Oil Change, Tune Up"
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-all',
                  errors.serviceType ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.serviceType && (
                <p className="mt-1.5 text-xs text-red-500">{errors.serviceType}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={cn(
                  'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-all',
                  errors.date ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                )}
              />
              {errors.date && (
                <p className="mt-1.5 text-xs text-red-500">{errors.date}</p>
              )}
            </div>
          </div>

          {/* Row: Cost + Receipt Number */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Cost (₱) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium">₱</span>
                <input
                  type="number"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                  className={cn(
                    'w-full rounded-lg border pl-8 pr-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-all',
                    errors.cost ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
                  )}
                />
              </div>
              {errors.cost && (
                <p className="mt-1.5 text-xs text-red-500">{errors.cost}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Receipt Number <span className="text-zinc-400">(optional)</span>
              </label>
              <input
                type="text"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                placeholder="e.g. 2025-00123"
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-all hover:ring-brand-teal"
              />
            </div>
          </div>

          {/* Row: Attached Picture */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Attached Picture <span className="text-zinc-400">(optional)</span>
            </label>
            {attachedPicture ? (
              <div className="relative overflow-hidden rounded-lg ring-1 ring-brand-sage">
                <img
                  src={attachedPicture}
                  alt={attachedPictureName || 'Uploaded preview'}
                  className="h-32 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAttachedPicture(null);
                    setAttachedPictureName('');
                    pictureError && setPictureError(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="size-4" />
                </button>
                <p className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
                  {attachedPictureName}
                </p>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-brand-sage px-4 py-6 transition-all hover:border-brand-teal hover:bg-brand-cream"
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
            {pictureError && (
              <p className="mt-1.5 text-xs text-red-500">{pictureError}</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Remarks <span className="text-zinc-400">(optional)</span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any additional notes about this service..."
              rows={3}
              className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-all hover:ring-brand-teal resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-5 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <Wrench className="size-4" />
              {initialRecord ? 'Save Changes' : 'Add Maintenance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}