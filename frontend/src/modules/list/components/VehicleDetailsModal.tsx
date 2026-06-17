import { useState } from 'react';
import { X, Loader2, Fuel, Wrench, Trash2, Edit3, AlertTriangle, ClipboardList, CheckCircle } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { updateVehicle, toggleVehicleRepair, deleteVehicle } from '../api/vehicles-api';
import type { Vehicle } from '@car-tracker/shared';

interface VehicleDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  vehicle: Vehicle | null;
}

export function VehicleDetailsModal({ isOpen, onClose, onSuccess, vehicle }: VehicleDetailsModalProps) {
  const { toast, confirm } = useNotification();
  const [deleting, setDeleting] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showRepairNote, setShowRepairNote] = useState(false);
  const [repairNote, setRepairNote] = useState('');

  // Edit form state
  const [editPlateNumber, setEditPlateNumber] = useState('');
  const [editMake, setEditMake] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editVehicleType, setEditVehicleType] = useState('');
  const [editFuelType, setEditFuelType] = useState('');

  if (!isOpen || !vehicle) return null;

  const isUnderRepair = vehicle.underRepair === true;

  function cancelEditing() {
    setEditing(false);
  }

  async function handleSaveEdit() {
    if (!vehicle) return;
    try {
      setEditing(true);
      await updateVehicle(vehicle.id, {
        plateNumber: editPlateNumber.trim(),
        make: editMake.trim(),
        model: editModel.trim(),
        year: Number(editYear),
        color: editColor.trim() || undefined,
        vehicleType: editVehicleType.trim() || undefined,
        fuelType: editFuelType.trim() || undefined,
      });
      toast('Vehicle updated successfully!', 'success');
      setEditing(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update vehicle', 'error');
      setEditing(false);
    }
  }

  async function handleDelete() {
    if (!vehicle) return;
    const confirmed = await confirm({
      title: 'Delete Vehicle?',
      message: `Are you sure you want to delete "${vehicle.year} ${vehicle.make} ${vehicle.model}" (${vehicle.plateNumber})? This action cannot be undone.`,
      type: 'danger',
    });
    if (!confirmed) return;

    try {
      setDeleting(true);
      await deleteVehicle(vehicle.id);
      toast('Vehicle deleted successfully!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to delete vehicle', 'error');
      setDeleting(false);
    }
  }

  function openRepairNoteModal() {
    setRepairNote('');
    setShowRepairNote(true);
  }

  async function handleSubmitRepairNote() {
    if (!vehicle || !repairNote.trim()) {
      toast('Please enter a reason for the repair.', 'info');
      return;
    }

    try {
      setRepairing(true);
      await toggleVehicleRepair(vehicle.id, true, repairNote.trim());
      toast('Vehicle marked under repair!', 'success');
      setShowRepairNote(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update vehicle repair status', 'error');
      setRepairing(false);
    }
  }

  async function handleDoneRepair() {
    if (!vehicle) return;
    const confirmed = await confirm({
      title: 'Done Repair?',
      message: `Mark "${vehicle.plateNumber}" as active and clear the repair notes?`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      setRepairing(true);
      await toggleVehicleRepair(vehicle.id, false, '');
      toast('Repair completed, vehicle is now active!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update vehicle repair status', 'error');
      setRepairing(false);
    }
  }

  const handleStartEditing = () => {
    if (!vehicle) return;
    setEditPlateNumber(vehicle.plateNumber);
    setEditMake(vehicle.make);
    setEditModel(vehicle.model);
    setEditYear(String(vehicle.year));
    setEditColor(vehicle.color ?? '');
    setEditVehicleType(vehicle.vehicleType ?? '');
    setEditFuelType(vehicle.fuelType ?? '');
    setEditing(true);
  };

  // ── Repair Note Modal ──────────────────────────────────────────
  if (showRepairNote) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) setShowRepairNote(false); }}
      >
        <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100">
                <ClipboardList className="size-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900">Mark Under Repair</h2>
                <p className="text-sm text-zinc-400">
                  {vehicle.plateNumber} — {vehicle.make} {vehicle.model}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRepairNote(false)}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Reason for Repair <span className="text-red-500">*</span>
            </label>
            <textarea
              value={repairNote}
              onChange={(e) => setRepairNote(e.target.value)}
              rows={4}
              className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none"
              placeholder="Describe why this vehicle needs repair..."
              autoFocus
            />
            <p className="mt-1.5 text-xs text-zinc-400">
              This note will be saved and visible in the vehicle details.
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
            <button
              type="button"
              onClick={() => setShowRepairNote(false)}
              className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitRepairNote}
              disabled={repairing || !repairNote.trim()}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97] ${
                repairing || !repairNote.trim()
                  ? 'bg-amber-400/50 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600'
              }`}
            >
              {repairing ? (
                <><Loader2 className="size-4 animate-spin" /> Saving…</>
              ) : (
                <><Wrench className="size-4" /> Mark Under Repair</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Edit Mode ──────────────────────────────────────────────────
  if (editing) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) cancelEditing(); }}
      >
        <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Edit Vehicle</h2>
              <p className="text-sm text-zinc-400">
                Update the details for this vehicle.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelEditing}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Form */}
          <div className="px-6 py-5 space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Plate Number</label>
                <input
                  type="text"
                  value={editPlateNumber}
                  onChange={(e) => setEditPlateNumber(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Year</label>
                <input
                  type="number"
                  value={editYear}
                  onChange={(e) => setEditYear(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Make</label>
                <input
                  type="text"
                  value={editMake}
                  onChange={(e) => setEditMake(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Model</label>
                <input
                  type="text"
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Color</label>
                <input
                  type="text"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Vehicle Type</label>
                <select
                  value={editVehicleType}
                  onChange={(e) => setEditVehicleType(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                >
                  <option value="">Select type...</option>
                  <option value="Sedan">Sedan</option>
                  <option value="SUV">SUV</option>
                  <option value="Truck">Truck</option>
                  <option value="Van">Van</option>
                  <option value="Motorcycle">Motorcycle</option>
                  <option value="Bus">Bus</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Fuel Type</label>
              <select
                value={editFuelType}
                onChange={(e) => setEditFuelType(e.target.value)}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              >
                <option value="">Select fuel type...</option>
                <option value="gasoline">Gasoline</option>
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-5">
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={editing}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors"
              >
                {editing ? <Loader2 className="size-4 animate-spin" /> : null}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Details View ───────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl bg-brand-cream px-6 py-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              {vehicle.make}
            </p>
            <p className="text-lg font-bold text-zinc-900">{vehicle.model}</p>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-moss/40 px-2.5 py-0.5 text-xs font-medium text-brand-teal">
              {vehicle.plateNumber}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-white/60 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body - Vehicle Details */}
        <div className="px-6 py-5 space-y-5">
          {/* Under Repair badge */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">Status</span>
            {isUnderRepair ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-600">
                <Wrench className="size-3.5" />
                Under Repair
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-600">
                <div className="size-2 rounded-full bg-green-500" />
                Active
              </span>
            )}
          </div>

          {/* Repair notes (if any) */}
          {vehicle.notes && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <ClipboardList className="size-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Repair Notes
                  </p>
                  <p className="mt-0.5 text-sm text-amber-800">{vehicle.notes}</p>
                </div>
              </div>
            </div>
          )}

          <div className="h-px bg-zinc-100" />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Year</span>
              <span className="mt-1 block font-medium text-zinc-900">{vehicle.year}</span>
            </div>
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Make</span>
              <span className="mt-1 block font-medium text-zinc-900">{vehicle.make}</span>
            </div>
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Model</span>
              <span className="mt-1 block font-medium text-zinc-900">{vehicle.model}</span>
            </div>
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Plate Number</span>
              <span className="mt-1 block font-medium text-zinc-900">{vehicle.plateNumber}</span>
            </div>
            {vehicle.color && (
              <div>
                <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Color</span>
                <span className="mt-1 block font-medium text-zinc-900">{vehicle.color}</span>
              </div>
            )}
            {vehicle.vehicleType && (
              <div>
                <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Type</span>
                <span className="mt-1 block font-medium text-zinc-900">{vehicle.vehicleType}</span>
              </div>
            )}
            {vehicle.fuelType && (
              <div>
                <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
                  <Fuel className="size-3.5 inline mr-1" /> Fuel
                </span>
                <span className="mt-1 block font-medium capitalize text-zinc-900">{vehicle.fuelType}</span>
              </div>
            )}
          </div>

          <div className="h-px bg-zinc-100" />

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-4 text-xs text-zinc-400">
            <div>
              <span className="block">Created</span>
              <span className="font-medium text-zinc-500">
                {new Date(vehicle.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
            <div>
              <span className="block">Last Updated</span>
              <span className="font-medium text-zinc-500">
                {new Date(vehicle.updatedAt).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Footer - Actions */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4">
          <div className="flex items-center gap-2">
            {/* Delete Button */}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Under Repair / Done Repair Button */}
            {isUnderRepair ? (
              <button
                onClick={handleDoneRepair}
                disabled={repairing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-green-700 active:scale-[0.97]"
              >
                {repairing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle className="size-3.5" />}
                Done Repair
              </button>
            ) : (
              <button
                onClick={openRepairNoteModal}
                disabled={repairing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-amber-600 active:scale-[0.97]"
              >
                <AlertTriangle className="size-3.5" />
                Under Repair
              </button>
            )}

            {/* Edit Button */}
            <button
              onClick={handleStartEditing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <Edit3 className="size-3.5" />
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}