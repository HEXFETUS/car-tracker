import { useState, useEffect } from 'react';
import { X, Pencil, Trash2, Loader2, MapPin, Calendar, User, Truck, UserCircle, FileText, CheckCircle, Send, Printer, Pen } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatDateManila, formatTimeManila, formatDateTimeManila } from '@/shared/lib/date-utils';
import { useNotification } from '@/shared/context/NotificationContext';
import { useAuth } from '@/modules/auth/context/auth-context';
import {
  updateTravelOrder,
  deleteTravelOrder,
  assignTravelOrder,
  fetchVehicles,
  fetchDrivers,
  type TravelOrderData,
} from '../api/travel-orders-api';
import { TravelOrderPrintModal } from './TravelOrderPrintModal';
import { SignatureModal } from '@/shared/components/SignatureModal';

interface TravelOrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: TravelOrderData | null;
  onSuccess: () => void;
}

interface VehicleOption {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
}

interface DriverOption {
  id: string;
  fullName: string;
  phone: string;
  licenseNumber: string;
}

/** Status badge colors matching the new design spec */
const statusBadgeColors: Record<string, string> = {
  PENDING: 'bg-blue-100 text-blue-800 border-blue-200',
  FOR_REQUEST: 'bg-orange-100 text-orange-800 border-orange-200',
  FOR_APPROVAL: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  ACTIVE: 'bg-green-100 text-green-800 border-green-200',
  COMPLETED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
};

function StatusBadge({ status }: { status: string }) {
  const color = statusBadgeColors[status] || 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`rounded-full px-3 py-0.5 text-xs font-semibold border ${color}`}>
      {status === 'FOR_REQUEST' ? 'FOR REQUEST' : status === 'FOR_APPROVAL' ? 'FOR APPROVAL' : status}
    </span>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-brand-teal shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-zinc-900">{value || '—'}</p>
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-100">
        <span className="text-brand-teal">{icon}</span>
        <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

export function TravelOrderDetailsModal({ isOpen, onClose, order, onSuccess }: TravelOrderDetailsModalProps) {
  const { toast, confirm } = useNotification();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [signatureModalState, setSignatureModalState] = useState<{
    isOpen: boolean;
    mode: 'request' | 'approve';
  }>({ isOpen: false, mode: 'request' });
  const [requestedBySignature, setRequestedBySignature] = useState<string | null>(null);
  const [approvedBySignature, setApprovedBySignature] = useState<string | null>(null);

  // Reset scroll position when modal opens
  useEffect(() => {
    if (isOpen) {
      window.scrollTo(0, 0);
    }
  }, [isOpen]);

  // Form state
  const [department, setDepartment] = useState('');
  const [travelerName, setTravelerName] = useState('');
  const [originLocation, setOriginLocation] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [scheduledDepartureAt, setScheduledDepartureAt] = useState('');
  const [scheduledArrivalAt, setScheduledArrivalAt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');

  // Assignment state (for PENDING orders)
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  // @ts-expect-error: setLoadingOptions is used inside loadOptions callback
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Reset form when order changes
  useEffect(() => {
    if (order && isOpen) {
      setDepartment(order.department || '');
      setTravelerName(order.travelerName || '');
      setOriginLocation(order.originLocation || '');
      setDestinationLocation(order.destinationLocation || '');
      setScheduledDepartureAt(order.scheduledDepartureAt ? toLocalDatetime(order.scheduledDepartureAt) : '');
      setScheduledArrivalAt(order.scheduledArrivalAt ? toLocalDatetime(order.scheduledArrivalAt) : '');
      setPurpose(order.purpose || '');
      setNotes(order.notes || '');
      setSelectedVehicleId(order.vehicleId || '');
      setSelectedDriverId(order.driverId || '');
      setIsEditing(false);

      // Load vehicles & drivers if the order is PENDING (needs assignment)
      if (order.status === 'PENDING') {
        loadOptions();
      }
    }
  }, [order, isOpen]);

  async function loadOptions() {
    setLoadingOptions(true);
    try {
      const [v, d] = await Promise.all([fetchVehicles(), fetchDrivers()]);
      setVehicles(v);
      setDrivers(d);
    } catch {
      // Silently fail — dropdowns will just be empty
    } finally {
      setLoadingOptions(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function toLocalDatetime(iso: string): string {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  }

  function formatDateOnly(dateStr: string | null) {
    return formatDateManila(dateStr);
  }

  function formatTimeOnly(dateStr: string | null) {
    return formatTimeManila(dateStr);
  }

  function handleClose() {
    setIsEditing(false);
    onClose();
  }

  /** Called when the user clicks "Save Assignment" in the edit form. */
  // @ts-expect-error: reserved for future assignment UI in edit mode
  async function handleAssignmentSubmit() {
    if (!order) return;

    const vehicle = vehicles.find((v) => v.id === selectedVehicleId);
    const driver = drivers.find((d) => d.id === selectedDriverId);

    if (!vehicle || !driver) {
      toast('Please select both a vehicle and a driver', 'error');
      return;
    }

    const confirmed = await confirm({
      title: 'Confirm Assignment',
      message: `Are you sure you want to assign Vehicle ${vehicle.plateNumber} and Driver ${driver.fullName} to this request? This will change the status to "For Approval".`,
      type: 'info',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await assignTravelOrder(order.id, selectedVehicleId, selectedDriverId);
      toast('Vehicle and driver assigned! Status moved to "For Approval".', 'success');
      setIsEditing(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to assign vehicle and driver', 'error');
    } finally {
      setSaving(false);
    }
  }

  /** Open signature modal for "For Request" action */
  function handleForRequestClick() {
    setSignatureModalState({ isOpen: true, mode: 'request' });
  }

  /** Called after signature is confirmed for "For Request" */
  async function handleSubmitForRequest(signatureDataUrl: string | null) {
    if (!order) return;

    const confirmed = await confirm({
      title: 'Submit For Request?',
      message: `Submit ${order.toNumber} as a travel request? The order will be visible in the Travel Requests module.`,
      type: 'info',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await updateTravelOrder(order.id, {
        status: 'FOR_REQUEST',
        requestedBySignature: signatureDataUrl || null,
      });
      toast('Travel order submitted for request!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to submit for request', 'error');
    } finally {
      setSaving(false);
    }
  }

  /** Convert a datetime-local value to an ISO string with local timezone offset. */
  function toLocalISO(datetimeLocal: string): string | undefined {
    if (!datetimeLocal) return undefined;
    const date = new Date(datetimeLocal);
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
    const hours = pad(Math.floor(Math.abs(offset) / 60));
    const minutes = pad(Math.abs(offset) % 60);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${hours}:${minutes}`;
  }

  /** Regular field save (non-assignment edits) */
  async function handleSave() {
    if (!order) return;

    const confirmed = await confirm({
      title: 'Save Changes?',
      message: `Are you sure you want to save the changes to ${order.toNumber}?`,
      type: 'info',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await updateTravelOrder(order.id, {
        department: department.trim(),
        travelerName: travelerName.trim(),
        originLocation: originLocation.trim(),
        destinationLocation: destinationLocation.trim(),
        scheduledDepartureAt: toLocalISO(scheduledDepartureAt),
        scheduledArrivalAt: toLocalISO(scheduledArrivalAt),
        purpose: purpose.trim(),
        notes: notes.trim(),
      });
      toast('Travel order updated!', 'success');
      onSuccess();
      handleClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Delete Travel Order?',
      message: `Are you sure you want to delete ${order.toNumber}? This action cannot be undone.`,
      type: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteTravelOrder(order.id);
      toast('Travel order deleted!', 'success');
      onClose();
      onSuccess();
    } catch (err: any) {
      toast(err.message || 'Failed to delete travel order', 'error');
    } finally {
      setDeleting(false);
    }
  }

  /** Open signature modal for "Approve" action */
  function handleApproveClick() {
    setSignatureModalState({ isOpen: true, mode: 'approve' });
  }

  /** Called after signature is confirmed for "Approve" */
  async function handleApprove(signatureDataUrl: string | null) {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Approve Travel Order?',
      message: `Approve ${order.toNumber} for ${order.travelerName}?`,
      type: 'info',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, {
        status: 'APPROVED',
        approvedBy: user!.id,
        approvedBySignature: signatureDataUrl || null,
      });
      toast('Travel order approved!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to approve travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeny() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Deny Travel Order?',
      message: `Deny ${order.toNumber} for ${order.travelerName}?`,
      type: 'warning',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, { status: 'CANCELLED', approvedBy: user!.id });
      toast('Travel order denied', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to deny travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  /** Reset an APPROVED order back to FOR_APPROVAL status (Superadmin only) */
  async function handleResetToForApproval() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Reset to For Approval?',
      message: `Reset ${order.toNumber} back to "For Approval" status? It will need to be approved again.`,
      type: 'warning',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, { status: 'FOR_APPROVAL', approvedBy: undefined });
      toast('Travel order reset to For Approval!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to reset travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  /** Reset a CANCELLED order back to PENDING status */
  async function handleResetCancelledToPending() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Reset Cancelled Order?',
      message: `Reset ${order.toNumber} back to "PENDING" status? The order will be moved back to the "Needs Assigning" tab for re-processing.`,
      type: 'warning',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, { status: 'PENDING' });
      toast('Travel order reset to Pending!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to reset travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  const canAssign = order?.status === 'PENDING';
  const canEditDelete = canAssign || order?.status === 'CANCELLED' || (order?.status === 'APPROVED' && user?.userType === 'SUPERADMIN');

  if (!isOpen || !order) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 py-0 sm:py-10 backdrop-blur-sm transition-opacity"
    >
      <div className="relative w-full max-w-4xl max-h-[100svh] sm:max-h-[calc(100svh-40px)] bg-white rounded-none sm:rounded-2xl shadow-brand-xl animate-in fade-in zoom-in-95 flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-zinc-100 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center rounded-full bg-brand-teal/10 px-3 py-1 text-sm font-bold text-brand-teal">
                {order.toNumber}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-zinc-400">
              Created {formatDateOnly(order.createdAt)} &bull; Created by {order.travelerName || 'Unknown'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isEditing && canEditDelete && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-brand-teal transition-colors"
                  title={canAssign ? "Edit / Assign" : "Edit"}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors disabled:opacity-40"
                  title="Delete"
                >
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 scroll-smooth">
          <div className="space-y-4">
            {/* Trip Information */}
            <SectionCard title="Trip Information" icon={<MapPin className="size-4" />}>
              <DetailRow
                icon={<FileText className="size-4" />}
                label="Purpose"
                value={
                  isEditing ? (
                    <textarea
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none hover:ring-brand-teal"
                    />
                  ) : (
                    order.purpose || '—'
                  )
                }
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow
                  icon={<MapPin className="size-4" />}
                  label="Origin"
                  value={
                    isEditing ? (
                      <input
                        type="text"
                        value={originLocation}
                        onChange={(e) => setOriginLocation(e.target.value)}
                        className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                      />
                    ) : (
                      order.originLocation || '—'
                    )
                  }
                />
              </div>

              {/* Route with stops */}
              <div className="mt-3">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Route</p>
                <div className="space-y-0">
                  {/* Origin */}
                  <div className="flex items-start gap-3 py-2">
                    <div className="flex flex-col items-center">
                      <div className="size-3 rounded-full bg-brand-teal border-2 border-white ring-2 ring-brand-teal shrink-0" />
                      <div className="w-0.5 flex-1 bg-brand-teal/30 min-h-[20px]" />
                    </div>
                    <div className="min-w-0 flex-1 pb-2">
                      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Origin</p>
                      <p className="text-sm font-medium text-zinc-900">{order.originLocation || '—'}</p>
                      {order.latLongOrigin && (
                        <p className="text-xs text-zinc-400">📍 {order.latLongOrigin}</p>
                      )}
                    </div>
                  </div>

                  {/* Destination Stops with Status */}
                  {order.destinations && order.destinations.length > 0 ? (
                    order.destinations.map((dest, index) => {
                      const status = dest.status || 'PENDING';
                      const isArrived = status === 'ARRIVED';
                      const isInProgress = status === 'IN_PROGRESS';
                      const isSkipped = status === 'SKIPPED';
                      const isPending = status === 'PENDING';
                      const isLast = index === order.destinations.length - 1;

                      return (
                        <div key={dest.id || index} className="flex items-start gap-3 py-2">
                          <div className="flex flex-col items-center">
                            <div className={cn(
                              'size-3 rounded-full border-2 shrink-0 transition-colors',
                              isArrived && 'bg-green-500 border-white ring-2 ring-green-500',
                              isInProgress && 'bg-blue-500 border-white ring-2 ring-blue-500 animate-pulse',
                              isPending && !isLast && 'bg-zinc-300 border-white ring-2 ring-zinc-300',
                              isPending && isLast && 'bg-amber-500 border-white ring-2 ring-amber-500',
                              isSkipped && 'bg-red-300 border-white ring-2 ring-red-300',
                            )}>
                              {isArrived && (
                                <svg className="size-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            {index < order.destinations.length - 1 && (
                              <div className={cn(
                                'w-0.5 flex-1 min-h-[20px]',
                                isArrived ? 'bg-green-300' : 'bg-zinc-200'
                              )} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 pb-2">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                                {isLast ? 'Final Destination' : `Stop ${index + 1}`}
                              </p>
                              {isArrived && (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                                  ✓ Arrived
                                </span>
                              )}
                              {isInProgress && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                  ▶ In Progress
                                </span>
                              )}
                              {isSkipped && (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                                  ✕ Skipped
                                </span>
                              )}
                              {isPending && (
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                                  ○ Pending
                                </span>
                              )}
                            </div>
                            <p className={cn(
                              'text-sm font-medium',
                              isArrived ? 'text-green-700' : isSkipped ? 'text-zinc-400 line-through' : 'text-zinc-900'
                            )}>
                              {dest.locationName}
                            </p>
                            {dest.address && (
                              <p className="text-xs text-zinc-500">{dest.address}</p>
                            )}
                            {dest.latLong && (
                              <p className="text-xs text-zinc-400">📍 {dest.latLong}</p>
                            )}
                            {dest.arrivedAt && (
                              <p className="text-xs text-green-600">
                                🕐 Arrived {formatDateTimeManila(dest.arrivedAt)}
                                {dest.arrivalDistanceMeters && ` (${dest.arrivalDistanceMeters}m)`}
                              </p>
                            )}
                            {dest.notes && (
                              <p className="text-xs text-zinc-400 italic mt-0.5">📝 {dest.notes}</p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    /* Fallback: single destination */
                    <div className="flex items-start gap-3 py-2">
                      <div className="flex flex-col items-center">
                        <div className="size-3 rounded-full bg-amber-500 border-2 border-white ring-2 ring-amber-500 shrink-0" />
                      </div>
                      <div className="min-w-0 flex-1 pb-2">
                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Destination</p>
                        <p className="text-sm font-medium text-zinc-900">{order.destinationLocation || '—'}</p>
                        {order.latLongDestination && (
                          <p className="text-xs text-zinc-400">📍 {order.latLongDestination}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Departure</p>
                  {isEditing ? (
                    <input
                      type="datetime-local"
                      value={scheduledDepartureAt}
                      onChange={(e) => setScheduledDepartureAt(e.target.value)}
                      className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4 text-brand-teal shrink-0" />
                      <p className="text-sm font-medium text-zinc-900">
                        {formatDateOnly(order.scheduledDepartureAt)}
                      </p>
                      <span className="text-sm text-zinc-500">
                        {formatTimeOnly(order.scheduledDepartureAt)}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Return</p>
                  {isEditing ? (
                    <input
                      type="datetime-local"
                      value={scheduledArrivalAt}
                      onChange={(e) => setScheduledArrivalAt(e.target.value)}
                      className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4 text-brand-teal shrink-0" />
                      <p className="text-sm font-medium text-zinc-900">
                        {formatDateOnly(order.scheduledArrivalAt)}
                      </p>
                      <span className="text-sm text-zinc-500">
                        {formatTimeOnly(order.scheduledArrivalAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Personnel */}
            <SectionCard title="Personnel" icon={<User className="size-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow
                  icon={<UserCircle className="size-4" />}
                  label="Traveler"
                  value={
                    isEditing ? (
                      <input
                        type="text"
                        value={travelerName}
                        onChange={(e) => setTravelerName(e.target.value)}
                        className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                      />
                    ) : (
                      order.travelerName || '—'
                    )
                  }
                />
                <DetailRow
                  icon={<FileText className="size-4" />}
                  label="Department"
                  value={
                    isEditing ? (
                      <input
                        type="text"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                      />
                    ) : (
                      order.department || '—'
                    )
                  }
                />
              </div>
            </SectionCard>

            {/* Vehicle & Driver */}
            <SectionCard title="Vehicle & Driver" icon={<Truck className="size-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow
                  icon={<Truck className="size-4" />}
                  label="Vehicle"
                  value={
                    order.plateNumber ? (
                      <>
                        {order.plateNumber}
                        {order.requestVehicle && <span className="ml-2 text-xs text-brand-teal">(Requested)</span>}
                      </>
                    ) : order.requestVehicle ? (
                      <span className="text-zinc-400">Requested (not yet assigned)</span>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow
                  icon={<UserCircle className="size-4" />}
                  label="Driver"
                  value={
                    order.driverName ? (
                      <>
                        {order.driverName}
                        {order.requestDriver && <span className="ml-2 text-xs text-brand-teal">(Requested)</span>}
                      </>
                    ) : order.requestDriver ? (
                      <span className="text-zinc-400">Requested (not yet assigned)</span>
                    ) : (
                      '—'
                    )
                  }
                />
              </div>
              {order.driverName && (
                <DetailRow
                  icon={<FileText className="size-4" />}
                  label="License No."
                  value="ABC12345"
                />
              )}
            </SectionCard>

            {/* Approval */}
            <SectionCard title="Approval" icon={<CheckCircle className="size-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow
                  icon={<User className="size-4" />}
                  label="Requested By"
                  value={order.travelerName || '—'}
                />
                <DetailRow
                  icon={<User className="size-4" />}
                  label="Approved By"
                  value={order.approvedByName || '—'}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow
                  icon={<Calendar className="size-4" />}
                  label="Date Approved"
                  value={order.updatedAt ? formatDateOnly(order.updatedAt) : '—'}
                />
                <DetailRow
                  icon={<CheckCircle className="size-4" />}
                  label="Status"
                  value={<StatusBadge status={order.status} />}
                />
              </div>
            </SectionCard>

            {/* Additional Information */}
            <SectionCard title="Additional Information" icon={<FileText className="size-4" />}>
              <DetailRow
                icon={<FileText className="size-4" />}
                label="Remarks"
                value={
                  isEditing ? (
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none hover:ring-brand-teal"
                    />
                  ) : (
                    order.notes || '—'
                  )
                }
              />
            </SectionCard>
          </div>
        </div>

        {/* ── Sticky Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 bg-white rounded-b-2xl shrink-0">
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                  className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </>
            ) : order.status === 'PENDING' ? (
              <>
              <button
                type="button"
                onClick={handleForRequestClick}
                disabled={saving}
                className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {saving ? 'Submitting…' : 'For Request'}
              </button>
              </>
            ) : order.status === 'FOR_APPROVAL' ? (
              <>
                <button
                  type="button"
                  onClick={handleDeny}
                  disabled={saving}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={handleApproveClick}
                  disabled={saving}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? 'Processing...' : 'Approve'}
                </button>
              </>
            ) : (
              <span className="text-sm text-zinc-400 italic">
                {order.status === 'FOR_REQUEST' && 'This order has been submitted for request'}
                {order.status === 'APPROVED' && 'This order has been approved'}
                {order.status === 'CANCELLED' && 'This order has been cancelled'}
                {order.status === 'ACTIVE' && 'This order is currently active'}
                {order.status === 'COMPLETED' && 'This order has been completed'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {order.status === 'APPROVED' && user?.userType === 'SUPERADMIN' && (
              <button
                type="button"
                onClick={handleResetToForApproval}
                disabled={saving}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? 'Resetting...' : 'Reset to For Approval'}
              </button>
            )}
            {order.status === 'CANCELLED' && (
              <button
                type="button"
                onClick={handleResetCancelledToPending}
                disabled={saving}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? 'Resetting...' : 'Reset to Pending'}
              </button>
            )}
            {order.status === 'APPROVED' && (
              <button
                type="button"
                onClick={() => setPrintPreviewOpen(true)}
                className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors inline-flex items-center gap-2"
              >
                <Printer className="size-4" />
                Print
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {order && (
        <TravelOrderPrintModal
          isOpen={printPreviewOpen}
          onClose={() => setPrintPreviewOpen(false)}
          order={order}
        />
      )}

      {/* Signature Modal for For Request / Approve */}
      <SignatureModal
        isOpen={signatureModalState.isOpen}
        onClose={() => setSignatureModalState({ ...signatureModalState, isOpen: false })}
        onConfirm={(dataUrl) => {
          setSignatureModalState({ ...signatureModalState, isOpen: false });
          if (signatureModalState.mode === 'request') {
            handleSubmitForRequest(dataUrl);
          } else {
            handleApprove(dataUrl);
          }
        }}
        currentValue={null}
        title={signatureModalState.mode === 'request' ? 'Sign to Submit for Request' : 'Sign to Approve'}
      />
    </div>
  );
}
