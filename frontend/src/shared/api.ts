const rawApiBase = import.meta.env.VITE_API_URL?.trim() ?? '';

function normaliseApiBase(value: string): string {
  const apiBase = value.replace(/\/$/, '');

  if (!apiBase) return '';

  if (import.meta.env.PROD) {
    try {
      const url = new URL(apiBase);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return '';
      }
    } catch {
      return apiBase;
    }
  }

  return apiBase;
}

export const API_BASE = normaliseApiBase(rawApiBase);
