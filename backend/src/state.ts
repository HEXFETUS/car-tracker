// ── In-Memory State Store ──────────────────────────────────────
//
// Lightweight key-value state management with TTL support.
// Tracks vehicle states (ignition, fuel, idling), fleet cache,
// and alert deduplication tokens.
//
// In production this can be swapped for Redis by replacing the
// internal Map with a client that implements the same interface.

interface StoreEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, StoreEntry>();

/**
 * Retrieve a previously stored JSON value.
 * Returns `defaultValue` when the key is missing or expired.
 */
export function getJson<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  const entry = store.get(key);
  if (!entry) return defaultValue;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return defaultValue;
  }
  return entry.value as T;
}

/**
 * Store a value under `key` with an optional TTL in seconds.
 * Default TTL is 600 seconds (10 minutes).
 */
export function setJson(key: string, value: unknown, ttlSeconds = 600): void {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  store.set(key, { value, expiresAt });
}

/**
 * Check whether an alert (identified by `alertKey`) was already
 * dispatched within the given `durationSeconds` window.
 *
 * Returns `true` if the key exists and hasn't expired, otherwise
 * stores the key and returns `false`.
 */
export async function alreadySentRecently(alertKey: string, nowMs: number, durationSeconds: number): Promise<boolean> {
  const sentKey = `sent:${alertKey}`;
  const existing = store.get(sentKey);
  if (existing) {
    return true;
  }
  store.set(sentKey, { value: true, expiresAt: nowMs + durationSeconds * 1000 });
  return false;
}

/**
 * Remove all entries from the store (useful for testing / clean-up).
 */
export function clearStore(): void {
  store.clear();
}