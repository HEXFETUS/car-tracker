import { useState, useEffect, useCallback } from 'react';
import { Wrench, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useNotification } from '@/shared/context/NotificationContext';
import { fetchMaintenanceRecords, updateMaintenance, deleteMaintenance } from '../api/maintenance-api';
import { NewMaintenanceModal } from '../components/NewMaintenanceModal';
import type { Maintenance } from '@car-tracker/shared';

export function MaintenancePage() {
  const { toast, confirm } = useNotification();
  const [records, setRecords] = useState<Maintenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRecord, setEditingRecord] = useState<Maintenance | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchMaintenanceRecords();
      setRecords(data);
    } catch (err) {
      toast('Failed to load maintenance records', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  async function handleEdit(payload: any) {
    if (!editingRecord) return;

    const confirmed = await confirm({
      title: 'Save Changes?',
      message: `You are about to update the "${editingRecord.serviceType}" service record. This action can be modified later.`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      await updateMaintenance(editingRecord.id, payload);
      toast('Maintenance record updated successfully!', 'success');
      setIsEditModalOpen(false);
      setEditingRecord(null);
      loadRecords();
    } catch (err: any) {
      toast(err.message || 'Failed to update maintenance record', 'error');
    }
  }

  async function handleDelete(record: Maintenance) {
    const confirmed = await confirm({
      title: 'Delete Maintenance Record?',
      message: `Are you sure you want to delete the "${record.serviceType}" service record for ${record.vehicleName ?? record.vehiclePlate ?? record.vehicleId}? This action cannot be undone.`,
      type: 'warning',
    });
    if (!confirmed) return;

    try {
      await deleteMaintenance(record.id);
      toast('Maintenance record deleted successfully!', 'success');
      loadRecords();
    } catch (err: any) {
      toast(err.message || 'Failed to delete maintenance record', 'error');
    }
  }

  function openEditModal(record: Maintenance) {
    setEditingRecord(record);
    setIsEditModalOpen(true);
  }

  function closeEditModal() {
    setIsEditModalOpen(false);
    setEditingRecord(null);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
        <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
        <p className="text-base font-medium text-zinc-600">Loading maintenance records…</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
        <div className="mb-4 rounded-full bg-brand-cream p-4">
          <Wrench className="size-8 text-brand-teal" />
        </div>
        <p className="text-base font-medium text-zinc-600">No maintenance records yet</p>
        <p className="mt-1 text-sm text-zinc-400">
          Maintenance records will appear here once vehicles are serviced.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl bg-white shadow-brand md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-cream text-left text-xs font-medium uppercase tracking-wider text-brand-teal">
              <th className="px-5 py-4">Vehicle</th>
              <th className="px-5 py-4">Service Type</th>
              <th className="px-5 py-4">Cost</th>
              <th className="px-5 py-4">Date</th>
              <th className="px-5 py-4">Receipt #</th>
              <th className="px-5 py-4">Photo</th>
              <th className="px-5 py-4">Remarks</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, idx) => (
              <tr
                key={record.id}
                className={cn(
                  'transition-colors',
                  idx % 2 === 0 ? 'bg-white' : 'bg-brand-cream/50',
                  'hover:bg-brand-moss/20',
                )}
              >
                <td className="px-5 py-4 font-medium text-zinc-900">
                  {record.vehicleName ?? record.vehiclePlate ?? record.vehicleId}
                </td>
                <td className="px-5 py-4 text-zinc-700">{record.serviceType}</td>
                <td className="px-5 py-4 font-medium text-zinc-900">
                  ₱{record.cost.toFixed(2)}
                </td>
                <td className="px-5 py-4 text-zinc-500">{record.date?.split('T')[0] ?? record.date}</td>
                <td className="px-5 py-4 text-zinc-500">
                  {record.receiptNumber || '—'}
                </td>
                <td className="px-5 py-4">
                  {record.attachedPicture ? (
                    <button
                      onClick={() => setPreviewImage(record.attachedPicture!)}
                      className="inline-flex items-center gap-1 text-brand-teal hover:underline"
                    >
                      <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      View
                    </button>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="max-w-[200px] truncate px-5 py-4 text-zinc-400">
                  {record.remarks || '—'}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => openEditModal(record)}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-brand-cream hover:text-brand-teal transition-colors"
                      title="Edit"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(record)}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-4 md:hidden">
        {records.map((record) => (
          <div key={record.id} className="rounded-xl bg-white p-5 shadow-brand">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="rounded-lg bg-brand-moss/40 p-2 text-brand-teal shrink-0">
                  <Wrench className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">
                    {record.vehicleName ?? record.vehiclePlate ?? record.vehicleId}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">{record.serviceType}</p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => openEditModal(record)}
                  className="rounded-lg p-2 text-zinc-400 hover:bg-brand-cream hover:text-brand-teal transition-colors"
                  title="Edit"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => handleDelete(record)}
                  className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-zinc-400">Cost</p>
                <p className="font-medium text-zinc-900">₱{record.cost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Date</p>
                <p className="text-zinc-700">{record.date?.split('T')[0] ?? record.date}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-zinc-400">Receipt #</p>
                <p className="text-zinc-700">{record.receiptNumber || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Photo</p>
                {record.attachedPicture ? (
                  <button
                    onClick={() => setPreviewImage(record.attachedPicture!)}
                    className="text-brand-teal hover:underline text-sm"
                  >
                    View Receipt
                  </button>
                ) : (
                  <p className="text-zinc-400">—</p>
                )}
              </div>
            </div>
            {record.remarks && (
              <p className="mt-3 rounded-lg bg-brand-cream px-3 py-2 text-xs text-zinc-500">
                {record.remarks}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Image Preview Overlay */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30 transition-colors"
          >
            <X className="size-6" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-h-[90vh] max-w-full rounded-lg shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Edit Maintenance Modal */}
      <NewMaintenanceModal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        onSubmit={handleEdit}
        initialRecord={
          editingRecord
            ? {
                id: editingRecord.id,
                vehicleId: editingRecord.vehicleId,
                serviceType: editingRecord.serviceType,
                cost: editingRecord.cost,
                date: editingRecord.date?.split('T')[0] ?? editingRecord.date,
                remarks: editingRecord.remarks,
                receiptNumber: editingRecord.receiptNumber,
                attachedPicture: editingRecord.attachedPicture,
              }
            : undefined
        }
      />
    </div>
  );
}