// ── Settings Card ───────────────────────────────────────────────
//
// Reusable compact card for settings sections.
// Icon + Title + Description + Status Badge + Key Details + Action Button

import { cn } from '@/shared/lib/utils';
import { Loader2 } from 'lucide-react';
import type React from 'react';

export type StatusVariant =
  | 'connected'
  | 'success'
  | 'healthy'
  | 'warning'
  | 'pending'
  | 'disconnected'
  | 'error'
  | 'info'
  | 'teal'
  | 'blue'
  | 'disabled'
  | 'degraded';

const STATUS_STYLES: Record<StatusVariant, { bg: string; text: string; dot: string; label: string }> = {
  connected: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Connected' },
  success: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Success' },
  healthy: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Healthy' },
  warning: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Warning' },
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Pending' },
  disconnected: { bg: 'bg-zinc-100', text: 'text-zinc-500', dot: 'bg-zinc-400', label: 'Disconnected' },
  error: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Error' },
  info: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Info' },
  teal: { bg: 'bg-brand-teal/10', text: 'text-brand-teal', dot: 'bg-brand-teal', label: 'Active' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Info' },
  disabled: { bg: 'bg-zinc-100', text: 'text-zinc-400', dot: 'bg-zinc-300', label: 'Disabled' },
  degraded: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Degraded' },
};

export function SettingsStatusBadge({ status }: { status: StatusVariant }) {
  const config = STATUS_STYLES[status] ?? STATUS_STYLES.disabled;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', config.bg, config.text)}>
      <span className={cn('size-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

export interface SettingsCardDetail {
  label: string;
  value: string | React.ReactNode;
}

export interface SettingsCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: StatusVariant;
  details: SettingsCardDetail[];
  action?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
  /** Optional extra content rendered below the details */
  children?: React.ReactNode;
  className?: string;
}

export function SettingsCard({
  icon,
  title,
  description,
  status,
  details,
  action,
  children,
  className,
}: SettingsCardProps) {
  return (
    <div className={cn('min-w-0 rounded-xl border border-zinc-100 bg-white p-3 shadow-brand sm:p-4', className)}>
      {/* Header: icon + title + status */}
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold text-zinc-900">{title}</h3>
            <SettingsStatusBadge status={status} />
          </div>
          <p className="mt-1 line-clamp-2 break-words text-xs text-zinc-400 sm:line-clamp-1">{description}</p>
        </div>
      </div>

      {/* Details in compact rows */}
      {details.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3">
          {details.map((detail, i) => (
            <div key={i} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="shrink-0 text-zinc-400">{detail.label}</span>
              <span className="min-w-0 break-words font-medium text-zinc-700 sm:truncate sm:text-right">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action button */}
      {action && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={action.onClick}
            disabled={action.loading || action.disabled}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-60 sm:w-auto"
          >
            {action.loading && <Loader2 className="size-3 animate-spin" />}
            {action.label}
          </button>
        </div>
      )}

      {/* Extra content */}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
