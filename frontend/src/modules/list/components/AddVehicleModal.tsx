import { useState, useEffect, useRef } from 'react';
import { X, Car, Fuel } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface AddVehicleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    plateNumber: string;
    make: string;
    model: string;
    year: number;
    color?: string;
    vehicleType?: string;
    fuelType?: string;
  }) => void;
}

interface FormErrors {
  plateNumber?: string;
  make?: string;
  model?: string;
  year?: string;
}

function FormSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-100">
        <span className="text-brand-teal">{icon}</span>
        <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function inputClass(error?: string) {
  return cn(
    'w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
    error ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal',
  );
}

export function AddVehicleModal({ isOpen, onClose, onSubmit }: AddVehicleModalProps) {
  const [plateNumber, setPlateNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPlateNumber('');
      setMake('');
      setModel('');
      setYear('');
      setColor('');
      setVehicleType('');
      setFuelType('');
      setErrors({});
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!plateNumber.trim()) errs.plateNumber = 'Plate Number is required';
    if (!make.trim()) errs.make = 'Make is required';
    if (!model.trim()) errs.model = 'Model is required';
    if (!year.trim()) {
      errs.year = 'Year is required';
    } else {
      const y = Number(year);
      if (isNaN(y) || y < 1900 || y > new Date().getFullYear() + 2) {
        errs.year = 'Enter a valid year';
      }
    }
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    onSubmit({
      plateNumber: plateNumber.trim(),
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      color: color.trim() || undefined,
      vehicleType: vehicleType.trim() || undefined,
      fuelType: fuelType.trim() || undefined,
    });
  }

   if (!isOpen) return null;

   return (
     <div
       ref={modalRef}
       className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm transition-opacity sm:px-4 sm:py-10"
     >
      <div className="relative min-h-dvh w-full max-w-2xl animate-in fade-in zoom-in-95 bg-white shadow-brand-xl sm:min-h-0 sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-4 sm:items-center sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-brand-teal/10">
              <Car className="size-5 text-brand-teal" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Add New Vehicle</h2>
              <p className="text-sm text-zinc-400">Fill in the details to register a new vehicle.</p>
            </div>
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
        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-5 sm:px-6">
          <FormSection title="Basic Information" icon={<Car className="size-4" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Plate Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  placeholder="e.g. ABC 1234"
                  className={inputClass(errors.plateNumber)}
                />
                {errors.plateNumber && (
                  <p className="mt-1 text-xs text-red-500">{errors.plateNumber}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Year <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g. 2025"
                  min={1900}
                  max={new Date().getFullYear() + 2}
                  className={inputClass(errors.year)}
                />
                {errors.year && (
                  <p className="mt-1 text-xs text-red-500">{errors.year}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Make <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="e.g. Toyota"
                  className={inputClass(errors.make)}
                />
                {errors.make && (
                  <p className="mt-1 text-xs text-red-500">{errors.make}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Model <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. Camry"
                  className={inputClass(errors.model)}
                />
                {errors.model && (
                  <p className="mt-1 text-xs text-red-500">{errors.model}</p>
                )}
              </div>
            </div>
          </FormSection>

          <FormSection title="Classification" icon={<Fuel className="size-4" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Color <span className="text-zinc-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="e.g. Silver"
                  className={inputClass()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Vehicle Type <span className="text-zinc-400">(optional)</span>
                </label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className={inputClass()}
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
            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Fuel Type <span className="text-zinc-400">(optional)</span>
              </label>
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                className={inputClass()}
              >
                <option value="">Select fuel type...</option>
                <option value="gasoline">Gasoline</option>
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
          </FormSection>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
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
              Add Vehicle
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
