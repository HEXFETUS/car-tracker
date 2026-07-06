/**
 * Shared date/time formatting utilities.
 * All dates are consistently displayed in Philippine Time (Asia/Manila, UTC+8).
 *
 * Backend always stores and returns UTC timestamps.
 * These functions convert UTC → PH Time for display only.
 */

/**
 * Format a date+time string to Philippine Time.
 * Example: "2026-07-06T07:39:00Z" → "Jul 6, 2026, 3:39 PM"
 */
export function formatDateTimeManila(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Format a date-only string to Philippine Time (no time component).
 * Example: "2026-07-06T07:39:00Z" → "Jul 6, 2026"
 */
export function formatDateManila(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Format a time-only string to Philippine Time.
 * Example: "2026-07-06T07:39:00Z" → "3:39 PM"
 */
export function formatTimeManila(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}