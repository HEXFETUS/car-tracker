import { useState, useRef, useEffect } from 'react';
import { X, Upload, MapPin, User, Truck, FileText, Calendar, ChevronRight, ChevronLeft, Plus, Trash2, GripVertical, Pencil } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { fetchNextToNumber } from '../api/travel-orders-api';
import { PlaceSearchInput } from './PlaceSearchInput';
import { PinpointMapModal } from './PinpointMapModal';
import { SignatureModal } from '@/shared/components/SignatureModal';
import { useNotification } from '@/shared/context/NotificationContext';
import type { TravelOrder, TravelOrderDestination } from '../types';
import { DEFAULT_ORIGIN_ADDRESS, DEFAULT_ORIGIN_LATLONG } from '../constants';

interface TravelOrderFormProps {
  onSubmit: (order: TravelOrder) => void;
  onCancel: () => void;
  existingCount?: number;
  /** If true, the date-issued field is editable (default: checking SUPERADMIN). */
  canEditDateIssued?: boolean;
  /** Optional override for the default origin. */
  defaultOrigin?: string;
  submitLabel?: string;
  cancelLabel?: string;
  /** Custom function to fetch the next TO number (defaults to the auth-required API). */
  fetchNextToNumberFn?: () => Promise<number>;
}

interface FormErrors {
  department?: string;
  travelerName?: string;
  departureDateTime?: string;
  returnDateTime?: string;
  boundFrom?: string;
  boundTo?: string;
  purpose?: string;
  destinations?: string;
}

type MapTarget = 'origin' | 'destination';
interface MapState {
  target: MapTarget;
  destIndex?: number;
  initialQuery: string;
}

function generateToNumber(seq: number): string {
  const year = new Date().getFullYear();
  return `TO-${year}-${String(seq).padStart(4, '0')}`;
}

/** Form step labels for the progress indicator */
const STEPS = [
  { key: 'trip', label: 'Trip Info', icon: <MapPin className="size-3.5" /> },
  { key: 'personnel', label: 'Personnel', icon: <User className="size-3.5" /> },
  { key: 'vehicle', label: 'Vehicle', icon: <Truck className="size-3.5" /> },
  { key: 'additional', label: 'Additional Info', icon: <FileText className="size-3.5" /> },
];

/** Reusable input with icon, label, and helper text */
function FormField({
  label,
  required,
  icon,
  helperText,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  icon: React.ReactNode;
  helperText?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 mb-1.5">
        <span className="text-brand-teal shrink-0">{icon}</span>
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {helperText && !error && (
        <p className="mt-1 text-xs text-zinc-400">{helperText}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}

/** Input styling class */
function inputClass(error?: string) {
  return cn(
    'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
    error
      ? 'border-red-300 bg-red-50'
      : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal'
  );
}

/** Section card with title */
function FormSection({ title, icon, step, children }: { title: string; icon: React.ReactNode; step?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(
      "rounded-xl border border-zinc-100 bg-white p-5 shadow-brand",
      step && "scroll-mt-4"
    )} id={`step-${step ? title.toLowerCase().replace(/\s+/g, '-') : ''}`}>
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-100">
        <span className="text-brand-teal">{icon}</span>
        <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function TravelOrderForm({
  onSubmit,
  onCancel,
  existingCount = 0,
  canEditDateIssued = false,
  defaultOrigin = DEFAULT_ORIGIN_ADDRESS,
  submitLabel = 'Create Travel Order',
  cancelLabel = 'Cancel',
  fetchNextToNumberFn,
}: TravelOrderFormProps) {
  const { confirm } = useNotification();
  const [department, setDepartment] = useState('');
  const [travelerName, setTravelerName] = useState('');
  const [departureDateTime, setDepartureDateTime] = useState('');
  const [returnDateTime, setReturnDateTime] = useState('');
  const [boundFrom, setBoundFrom] = useState(defaultOrigin);
  const [purpose, setPurpose] = useState('');
  const [requestVehicle, setRequestVehicle] = useState(false);
  const [requestDriver, setRequestDriver] = useState(false);
  const [vehicleName, setVehicleName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [travelerSignature, setTravelerSignature] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isDragging, setIsDragging] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);

  // Lat/Lng state
  const [latLongOrigin, setLatLongOrigin] = useState<string | null>(null);

  // Track whether location was pinpointed via the map (hides "Show on Map" footer)
  const [originPinpointed, setOriginPinpointed] = useState(false);

  // Multiple destinations state
  const [destinations, setDestinations] = useState<TravelOrderDestination[]>([
    { stopOrder: 1, locationName: '', address: null, latLong: null, notes: null },
  ]);
  const [destPinpointed, setDestPinpointed] = useState<Record<number, boolean>>({});

  // Map modal state
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>({ target: 'origin', initialQuery: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Next TO number state (fetched from API)
  const [nextSeq, setNextSeq] = useState<number>(1);
  const toNumber = generateToNumber(nextSeq);
  const [dateIssued, setDateIssued] = useState(new Date().toISOString().slice(0, 10));

  // Fetch next TO number on mount
  useEffect(() => {
    setDepartment('');
    setTravelerName('');
    setDepartureDateTime('');
    setReturnDateTime('');
    setBoundFrom(defaultOrigin);
    setPurpose('');
    setRequestVehicle(false);
    setRequestDriver(false);
    setRemarks('');
    setTravelerSignature(null);
    setImageData(null);
    setImageName('');
    setErrors({});
    setDateIssued(new Date().toISOString().slice(0, 10));
    setLatLongOrigin(null);
    setOriginPinpointed(false);
    setDestinations([{ stopOrder: 1, locationName: '', address: null, latLong: null, notes: null }]);
    setDestPinpointed({});
    setCurrentStep(0);

    const fetcher = fetchNextToNumberFn ?? fetchNextToNumber;
    fetcher()
      .then((seq) => setNextSeq(seq))
      .catch(() => {
        setNextSeq(existingCount + 1);
      });
  }, []);

  function validate(): FormErrors {
    const errs: FormErrors = {};

    // Required field checks
    if (!department.trim()) errs.department = 'Department is required';
    if (!travelerName.trim()) errs.travelerName = 'Traveler name is required';
    if (!boundFrom.trim()) errs.boundFrom = 'Origin is required';
    if (!purpose.trim()) errs.purpose = 'Purpose of travel is required';

    // Validate at least one destination has a location name
    const validDestinations = destinations.filter((d) => d.locationName.trim());
    if (validDestinations.length === 0) {
      errs.destinations = 'At least one destination is required';
    }

    // Date validation
    if (!departureDateTime) {
      errs.departureDateTime = 'Departure date & time is required';
    }
    if (!returnDateTime) {
      errs.returnDateTime = 'Return date & time is required';
    }

    // If both dates are present, validate ordering
    if (departureDateTime && returnDateTime) {
      const dep = new Date(departureDateTime).getTime();
      const ret = new Date(returnDateTime).getTime();

      if (ret === dep) {
        errs.returnDateTime = 'Return date and time must be later than the departure date and time.';
      } else if (ret < dep) {
        errs.returnDateTime = 'Return date and time cannot be earlier than the departure date and time.';
      }
    }

    return errs;
  }

  // Real-time validation: revalidate whenever the date fields change
  useEffect(() => {
    if (departureDateTime || returnDateTime) {
      setErrors((prev) => {
        const next = validate();
        // Only update if there are date-related errors or if they cleared
        if (
          next.departureDateTime !== prev.departureDateTime ||
          next.returnDateTime !== prev.returnDateTime
        ) {
          return next;
        }
        return prev;
      });
    }
  }, [departureDateTime, returnDateTime]);

  function buildOrder(): TravelOrder {
    const validDestinations = destinations
      .filter((d) => d.locationName.trim())
      .map((d, i) => ({ ...d, stopOrder: i + 1 }));

    const lastDest = validDestinations[validDestinations.length - 1];

    // ── Default origin coordinates ──
    // If the origin matches the default address (ignoring case/extra spaces),
    // force the default coordinates even if the user didn't interact with the map.
    const originNormalized = boundFrom.replace(/\s+/g, ' ').trim().toLowerCase();
    const defaultNormalized = DEFAULT_ORIGIN_ADDRESS.replace(/\s+/g, ' ').trim().toLowerCase();
    const isDefaultOrigin = !boundFrom || originNormalized === defaultNormalized;
    const resolvedLatLongOrigin = isDefaultOrigin
      ? DEFAULT_ORIGIN_LATLONG
      : latLongOrigin;

    return {
      toNumber,
      dateIssued,
      department: department.trim(),
      travelerName: travelerName.trim(),
      departureDateTime,
      returnDateTime,
      boundFrom: boundFrom.trim(),
      boundTo: lastDest?.locationName || '',
      purpose: purpose.trim(),
      requestVehicle,
      requestDriver,
      remarks: remarks.trim() || undefined,
      travelerSignature,
      imageAttachment: imageData,
      status: 'pending',
      latLongOrigin: resolvedLatLongOrigin,
      latLongDestination: lastDest?.latLong || null,
      destinations: validDestinations,
    };
  }

  /** Called when user clicks "Create Travel Order" on the Review step */
  async function handleReviewSubmit() {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const firstError = document.querySelector('.border-red-300');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const order = buildOrder();
    const destNames = order.destinations?.map((d) => d.locationName).join(' → ') || order.boundTo;
    const confirmed = await confirm({
      title: 'Save Travel Order?',
      message: `You are about to create a new travel order from "${order.boundFrom}" to "${destNames}" for ${order.travelerName}. This action can be modified later.`,
      type: 'info',
    });
    if (!confirmed) return;

    onSubmit(order);
  }

  /** Check if the current step has errors */
  function stepHasErrors(stepIndex: number): boolean {
    const errs = validate();
    switch (stepIndex) {
      case 0: // Trip Info
        return !!(errs.boundFrom || errs.destinations || errs.departureDateTime || errs.returnDateTime || errs.purpose);
      case 1: // Personnel
        return !!(errs.department || errs.travelerName);
      default:
        return false;
    }
  }

  function goToStep(step: number) {
    if (step < 0) step = 0;
    if (step >= STEPS.length) step = STEPS.length - 1;
    setCurrentStep(step);
    // Scroll to top of form
    document.querySelector('[data-form-container]')?.scrollTo({ top: 0, behavior: 'smooth' });
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

  function handleSelectDestinationLocation(index: number, placeName: string, lat: string, lng: string) {
    setDestinations((prev) =>
      prev.map((d, i) =>
        i === index ? { ...d, locationName: placeName, latLong: `${lat},${lng}` } : d,
      ),
    );
  }

  function addDestination() {
    setDestinations((prev) => [
      ...prev,
      { stopOrder: prev.length + 1, locationName: '', address: null, latLong: null, notes: null },
    ]);
  }

  function removeDestination(index: number) {
    if (destinations.length <= 1) return;
    setDestinations((prev) =>
      prev.filter((_, i) => i !== index).map((d, i) => ({ ...d, stopOrder: i + 1 })),
    );
    setDestPinpointed((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function updateDestination(index: number, field: keyof TravelOrderDestination, value: any) {
    setDestinations((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
    );
  }

  function openMapForOrigin() {
    setMapState({ target: 'origin', initialQuery: boundFrom });
    setIsMapOpen(true);
  }

  function openMapForDestination(index: number) {
    setMapState({ target: 'destination', destIndex: index, initialQuery: destinations[index]?.locationName || '' });
    setIsMapOpen(true);
  }

  function handleMapConfirm(lat: string, lng: string, address: string) {
    if (mapState.target === 'origin') {
      setBoundFrom(address);
      setLatLongOrigin(`${lat},${lng}`);
      setOriginPinpointed(true);
    } else if (mapState.destIndex !== undefined) {
      setDestinations((prev) =>
        prev.map((d, i) =>
          i === mapState.destIndex ? { ...d, locationName: address, latLong: `${lat},${lng}` } : d,
        ),
      );
      setDestPinpointed((prev) => ({ ...prev, [mapState.destIndex!]: true }));
    }
  }

  return (
    <>
      {/* No form element — all buttons are type="button" to prevent accidental submission */}
      <div className="flex flex-col h-full">
        {/* ── Progress Header ── */}
        <div className="mb-5">
          <div className="flex items-center justify-between px-1">
            {STEPS.map((step, i) => (
              <button
                key={step.key}
                type="button"
                onClick={() => goToStep(i)}
                className={cn(
                  'flex flex-col items-center gap-1 transition-colors group',
                  i === currentStep
                    ? 'text-brand-teal'
                    : i < currentStep
                      ? 'text-brand-teal/60'
                      : 'text-zinc-300 cursor-default'
                )}
              >
                <div className={cn(
                  'flex items-center justify-center size-8 rounded-full border-2 transition-all',
                  i === currentStep
                    ? 'border-brand-teal bg-brand-teal text-white'
                    : i < currentStep
                      ? 'border-brand-teal/60 bg-brand-teal/10 text-brand-teal/60'
                      : 'border-zinc-200 bg-white text-zinc-300'
                )}>
                  {i < currentStep ? (
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold">{i + 1}</span>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-1">
                  {step.icon}
                  <span className="text-xs font-medium">{step.label}</span>
                </div>
              </button>
            ))}
          </div>
          {/* Progress bar */}
          <div className="relative mt-3 h-1 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-teal rounded-full transition-all duration-300"
              style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* ── Scrollable Form Body ── */}
        <div className="flex-1 overflow-y-auto space-y-4" data-form-container>
          {/* Row: TO Number + Date Issued (always visible) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 mb-1.5">
                <FileText className="size-4 text-brand-teal" />
                TO Number
              </label>
              <input
                type="text"
                value={toNumber}
                readOnly
                className="w-full rounded-lg bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 mb-1.5">
                <Calendar className="size-4 text-brand-teal" />
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

          {/* Step 1: Trip Information */}
          {currentStep === 0 && (
            <FormSection title="Trip Information" icon={<MapPin className="size-4" />} step>
              <div className="space-y-4">
                <FormField
                  label="Purpose"
                  required
                  icon={<FileText className="size-4" />}
                  helperText="Briefly describe the purpose of travel."
                  error={errors.purpose}
                >
                  <textarea
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={3}
                    placeholder="e.g. Official business meeting"
                    className={inputClass(errors.purpose) + ' resize-none'}
                  />
                </FormField>

                {/* Origin */}
                <FormField
                  label="Origin"
                  required
                  icon={<MapPin className="size-4" />}
                  error={errors.boundFrom}
                >
                  <PlaceSearchInput
                    value={boundFrom}
                    onChange={setBoundFrom}
                    onSelectLocation={handleSelectOriginLocation}
                    placeholder="e.g. Manila"
                    error={errors.boundFrom}
                    mapLabel="Show on Map to set exact location"
                    onShowOnMap={openMapForOrigin}
                    hideShowOnMap={originPinpointed}
                  />
                  {latLongOrigin && (
                    <p className="mt-1 text-xs text-zinc-400">
                      Coordinates: {latLongOrigin}
                    </p>
                  )}
                </FormField>

                {/* Destination Stops */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700">
                      <MapPin className="size-4 text-brand-teal" />
                      Destinations
                      <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={addDestination}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-teal/10 px-3 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/20 transition-colors"
                    >
                      <Plus className="size-3.5" />
                      Add Destination
                    </button>
                  </div>
                  {errors.destinations && (
                    <p className="mb-2 text-xs text-red-500">{errors.destinations}</p>
                  )}

                  <div className="space-y-3">
                    {destinations.map((dest, index) => (
                      <div
                        key={index}
                        className={cn(
                          'rounded-lg border p-3 transition-colors',
                          errors.destinations && !dest.locationName.trim()
                            ? 'border-red-300 bg-red-50'
                            : 'border-zinc-200 bg-white'
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <GripVertical className="size-4 text-zinc-300" />
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Destination {index + 1}
                            </span>
                            {index === destinations.length - 1 && destinations.length > 1 && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Final
                              </span>
                            )}
                          </div>
                          {destinations.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeDestination(index)}
                              className="rounded-full p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                              title="Remove destination"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="space-y-2">
                          <PlaceSearchInput
                            value={dest.locationName}
                            onChange={(val) => updateDestination(index, 'locationName', val)}
                            onSelectLocation={(placeName, lat, lng) =>
                              handleSelectDestinationLocation(index, placeName, lat, lng)
                            }
                            placeholder={`e.g. Destination ${index + 1}`}
                            mapLabel="Show on Map to set exact location"
                            onShowOnMap={() => openMapForDestination(index)}
                            hideShowOnMap={destPinpointed[index]}
                          />
                          {dest.latLong && (
                            <p className="text-xs text-zinc-400">
                              Coordinates: {dest.latLong}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Departure Date"
                    required
                    icon={<Calendar className="size-4" />}
                    error={errors.departureDateTime}
                  >
                    <input
                      type="datetime-local"
                      value={departureDateTime}
                      onChange={(e) => setDepartureDateTime(e.target.value)}
                      className={inputClass(errors.departureDateTime)}
                    />
                  </FormField>
                  <FormField
                    label="Return Date"
                    required
                    icon={<Calendar className="size-4" />}
                    error={errors.returnDateTime}
                  >
                    <input
                      type="datetime-local"
                      value={returnDateTime}
                      onChange={(e) => setReturnDateTime(e.target.value)}
                      className={inputClass(errors.returnDateTime)}
                    />
                  </FormField>
                </div>
              </div>
            </FormSection>
          )}

          {/* Step 2: Personnel */}
          {currentStep === 1 && (
            <FormSection title="Personnel" icon={<User className="size-4" />} step>
              <div className="space-y-4">
                <FormField
                  label="Traveler"
                  required
                  icon={<User className="size-4" />}
                  helperText="Full name of the traveler."
                  error={errors.travelerName}
                >
                  <input
                    type="text"
                    value={travelerName}
                    onChange={(e) => setTravelerName(e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                    className={inputClass(errors.travelerName)}
                  />
                </FormField>
                <FormField
                  label="Department"
                  required
                  icon={<FileText className="size-4" />}
                  helperText="Requesting office or department."
                  error={errors.department}
                >
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. HR Department"
                    className={inputClass(errors.department)}
                  />
                </FormField>
              </div>
            </FormSection>
          )}

          {/* Step 3: Vehicle & Driver */}
          {currentStep === 2 && (
            <FormSection title="Vehicle & Driver" icon={<Truck className="size-4" />} step>
              <div className="space-y-4">
                {/* Toggle switches */}
                <div className="flex flex-wrap gap-6 pb-2">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Vehicle"
                    icon={<Truck className="size-4" />}
                    helperText={requestVehicle ? "Vehicle will be assigned by fleet management." : "Select or enter vehicle details."}
                  >
                    <input
                      type="text"
                      placeholder="e.g. KAR6412"
                      value={vehicleName}
                      onChange={(e) => setVehicleName(e.target.value)}
                      disabled={requestVehicle}
                      className={inputClass() + (requestVehicle ? ' bg-zinc-50 text-zinc-400 cursor-not-allowed' : '')}
                    />
                  </FormField>
                  <FormField
                    label="Driver"
                    icon={<User className="size-4" />}
                    helperText={requestDriver ? "Driver will be assigned by fleet management." : "Select or enter driver name."}
                  >
                    <input
                      type="text"
                      placeholder="e.g. Pedro Santos"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      disabled={requestDriver}
                      className={inputClass() + (requestDriver ? ' bg-zinc-50 text-zinc-400 cursor-not-allowed' : '')}
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Fuel Allocation"
                    icon={<FileText className="size-4" />}
                    helperText={requestVehicle ? "Auto-calculated when vehicle is assigned." : "Estimated fuel needed (in liters)."}
                  >
                    <input
                      type="text"
                      placeholder="e.g. 20 L"
                      disabled={requestVehicle}
                      className={inputClass() + (requestVehicle ? ' bg-zinc-50 text-zinc-400 cursor-not-allowed' : '')}
                    />
                  </FormField>
                  <FormField
                    label="Expected Distance"
                    icon={<MapPin className="size-4" />}
                    helperText={requestVehicle ? "Auto-calculated when vehicle is assigned." : "Estimated travel distance."}
                  >
                    <input
                      type="text"
                      placeholder="e.g. 50 km"
                      disabled={requestVehicle}
                      className={inputClass() + (requestVehicle ? ' bg-zinc-50 text-zinc-400 cursor-not-allowed' : '')}
                    />
                  </FormField>
                </div>
              </div>
            </FormSection>
          )}

          {/* Step 4: Additional Information (Review) */}
          {currentStep === 3 && (
            <FormSection title="Additional Information" icon={<FileText className="size-4" />} step>
              <div className="space-y-4">
                {/* Traveler Signature */}
                <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
                      <Pencil className="size-4 text-amber-600" />
                      Traveler Signature
                      <span className="text-red-500">*</span>
                    </label>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                      Required
                    </span>
                  </div>
                  {travelerSignature ? (
                    <div className="relative overflow-hidden rounded-lg ring-2 ring-amber-300">
                      <img
                        src={travelerSignature}
                        alt="Traveler signature"
                        className="h-28 w-full object-contain bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setIsSignatureModalOpen(true)}
                        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity"
                      >
                        <span className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm">
                          Re-sign
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTravelerSignature(null)}
                        className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-red-500 hover:bg-white hover:text-red-600 shadow-sm transition-colors"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsSignatureModalOpen(true)}
                      className="flex w-full items-center justify-center gap-3 rounded-lg border-2 border-dashed border-amber-300 bg-white px-4 py-10 text-sm text-zinc-500 hover:border-amber-500 hover:bg-amber-50 transition-all group"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex size-12 items-center justify-center rounded-full bg-amber-100 group-hover:bg-amber-200 transition-colors">
                          <Pencil className="size-6 text-amber-600" />
                        </div>
                        <span className="font-semibold text-zinc-700">Tap to sign</span>
                        <span className="text-xs text-zinc-400">Use your finger or mouse to draw your signature</span>
                      </div>
                    </button>
                  )}
                </div>

                <FormField
                  label="Remarks"
                  icon={<FileText className="size-4" />}
                  helperText="Any additional notes or instructions."
                >
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={3}
                    placeholder="Any additional notes..."
                    className={inputClass() + ' resize-none'}
                  />
                </FormField>

                {/* Attach Picture */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 mb-1.5">
                    <Upload className="size-4 text-brand-teal" />
                    Attachments <span className="text-zinc-400">(future)</span>
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
              </div>
            </FormSection>
          )}
        </div>

        {/* ── Footer Actions ── */}
        {/* All buttons use type="button" — no type="submit" anywhere */}
        <div className="flex items-center justify-between pt-5 border-t border-zinc-100 mt-5 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
          >
            {cancelLabel}
          </button>
          <div className="flex items-center gap-3">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => goToStep(currentStep - 1)}
                className="rounded-lg ring-1 ring-brand-sage px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors inline-flex items-center gap-1"
              >
                <ChevronLeft className="size-4" />
                Previous
              </button>
            )}
            {currentStep < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => goToStep(currentStep + 1)}
                disabled={stepHasErrors(currentStep)}
                className={cn(
                  'rounded-lg px-5 py-2.5 text-sm font-medium inline-flex items-center gap-1 transition-colors',
                  stepHasErrors(currentStep)
                    ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
                    : 'bg-brand-teal text-white hover:bg-brand-teal/80'
                )}
              >
                Next
                <ChevronRight className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleReviewSubmit}
                disabled={Object.keys(validate()).length > 0}
                className={cn(
                  'rounded-lg px-5 py-2.5 text-sm font-medium transition-colors',
                  Object.keys(validate()).length > 0
                    ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
                    : 'bg-brand-teal text-white hover:bg-brand-teal/80'
                )}
              >
                {submitLabel}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pinpoint Map Modal */}
      <PinpointMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        onConfirm={handleMapConfirm}
        initialQuery={mapState.initialQuery}
        initialLat={mapState.target === 'origin' ? DEFAULT_ORIGIN_LATLONG.split(',')[0] : undefined}
        initialLng={mapState.target === 'origin' ? DEFAULT_ORIGIN_LATLONG.split(',')[1] : undefined}
        locationLabel={
          mapState.target === 'origin'
            ? 'Origin'
            : `Destination ${(mapState.destIndex ?? 0) + 1}`
        }
      />

      {/* Signature Modal */}
      <SignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onConfirm={(dataUrl) => setTravelerSignature(dataUrl)}
        currentValue={travelerSignature}
      />
    </>
  );
}