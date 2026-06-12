import { useEffect, useRef } from 'react';
import { useNotification, type ConfirmType } from '@/shared/context/NotificationContext';
import {
  AlertTriangle,
  Info,
  OctagonAlert,
  X,
} from 'lucide-react';

// ── Type config ────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  ConfirmType,
  {
    icon: typeof AlertTriangle;
    iconBg: string;
    iconColor: string;
    confirmBg: string;
    confirmHover: string;
    confirmRing: string;
  }
> = {
  danger: {
    icon: OctagonAlert,
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    confirmBg: 'bg-red-600',
    confirmHover: 'hover:bg-red-700',
    confirmRing: 'focus-visible:ring-red-500',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    confirmBg: 'bg-amber-600',
    confirmHover: 'hover:bg-amber-700',
    confirmRing: 'focus-visible:ring-amber-500',
  },
  info: {
    icon: Info,
    iconBg: 'bg-brand-teal/10',
    iconColor: 'text-brand-teal',
    confirmBg: 'bg-brand-teal',
    confirmHover: 'hover:bg-brand-teal/80',
    confirmRing: 'focus-visible:ring-brand-teal',
  },
};

// ── Component ──────────────────────────────────────────────────

export function ConfirmationModal() {
  const {
    confirmationState: { open, resolve, options },
    closeConfirmation,
  } = useNotification();

  const confirmRef = useRef<HTMLButtonElement>(null);

  const config = TYPE_CONFIG[options.type ?? 'info'];
  const Icon = config.icon;

  /* Trap focus & handle Escape / Enter */
  useEffect(() => {
    if (!open) return;
    // small delay so the button is mounted
    const timer = setTimeout(() => confirmRef.current?.focus(), 50);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolve(false);
        closeConfirmation();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        resolve(true);
        closeConfirmation();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, resolve, closeConfirmation]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
        onClick={() => {
          resolve(false);
          closeConfirmation();
        }}
      />

      {/* Modal panel */}
      <div
        className="relative z-10 w-full max-w-md animate-[scaleIn_200ms_ease-out]"
      >
        <div className="rounded-2xl bg-white p-6 shadow-brand-xl">
          {/* Close icon */}
          <button
            onClick={() => {
              resolve(false);
              closeConfirmation();
            }}
            className="absolute right-4 top-4 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>

          {/* Icon + title + message */}
          <div className="flex flex-col items-center text-center">
            <div
              className={`mb-4 flex size-12 items-center justify-center rounded-full ${config.iconBg}`}
            >
              <Icon className={`size-6 ${config.iconColor}`} />
            </div>

            <h2
              id="confirm-title"
              className="text-lg font-semibold text-zinc-900"
            >
              {options.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {options.message}
            </p>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                resolve(false);
                closeConfirmation();
              }}
              className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
            >
              Cancel
            </button>

            <button
              ref={confirmRef}
              onClick={() => {
                resolve(true);
                closeConfirmation();
              }}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${config.confirmBg} ${config.confirmHover} ${config.confirmRing}`}
            >
              {options.type === 'danger'
                ? 'Delete'
                : options.type === 'warning'
                  ? 'Continue'
                  : 'Confirm'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Keyframes (injected once) ── */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideOutRight {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}