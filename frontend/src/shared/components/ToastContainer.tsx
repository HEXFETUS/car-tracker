import { useEffect, useRef, useState } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

// ── Variant config ─────────────────────────────────────────────

const VARIANT_CONFIG = {
  success: {
    bg: 'bg-brand-moss/30 ring-1 ring-brand-sage',
    icon: CheckCircle2,
    iconColor: 'text-brand-sage',
    title: 'Success',
  },
  error: {
    bg: 'bg-red-50 ring-1 ring-red-200',
    icon: XCircle,
    iconColor: 'text-red-600',
    title: 'Error',
  },
  info: {
    bg: 'bg-brand-cream ring-1 ring-brand-sage',
    icon: Info,
    iconColor: 'text-brand-teal',
    title: 'Info',
  },
} as const;

// ── Individual toast item ──────────────────────────────────────

interface ToastItemProps {
  id: string;
  message: string;
  variant: keyof typeof VARIANT_CONFIG;
  onDismiss: (id: string) => void;
}

function ToastItem({ id, message, variant, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  useEffect(() => {
    // Auto-dismiss after 3 seconds
    timerRef.current = setTimeout(() => {
      setExiting(true);
      // After slide-out animation (300ms), remove from DOM
      setTimeout(() => onDismiss(id), 300);
    }, 3000);

    return () => clearTimeout(timerRef.current);
  }, [id, onDismiss]);

  function handleDismiss() {
    clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(() => onDismiss(id), 300);
  }

  return (
    <div
      className={`flex w-full max-w-sm items-start gap-3 rounded-xl border p-4 shadow-lg backdrop-blur-sm transition-all duration-300 ${
        config.bg
      } ${
        exiting
          ? 'animate-[slideOutRight_300ms_ease-in_forwards]'
          : 'animate-[slideInRight_300ms_ease-out]'
      }`}
      role="alert"
    >
      <Icon className={`mt-0.5 size-5 shrink-0 ${config.iconColor}`} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900">{config.title}</p>
        <p className="mt-0.5 text-sm text-zinc-600">{message}</p>
      </div>

      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/60 hover:text-zinc-600"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

// ── Container ──────────────────────────────────────────────────

export function ToastContainer() {
  const { toasts, dismissToast } = useNotification();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9998] flex flex-col-reverse gap-3"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          id={t.id}
          message={t.message}
          variant={t.variant}
          onDismiss={dismissToast}
        />
      ))}

      {/* Keyframes (injected once) */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideOutRight {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}