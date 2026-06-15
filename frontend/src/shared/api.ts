const rawApiBase = import.meta.env.VITE_API_URL?.trim() ?? '';

export const API_BASE = rawApiBase.replace(/\/$/, '');
