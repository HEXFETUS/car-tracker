// ── In-Memory State Store ──────────────────────────────────────
//
// Provides lightweight key-value state management with TTL support
// for tracking vehicle states, ignition flags, fuel levels, and
// alert deduplication tokens.
//
// In production, this could be swapped for Redis or another
// external store by replacing the internal Map with a client
// that implements the same get/set interface.

/** @type {Map<string, { value: any, expiresAt: number }>} */
const store = new Map();

/**
 * Retrieve a JSON-deserialized value from the store.
 * Returns `defaultValue` if the key does not exist or has expired.
 *
 * @param {string} key
 * @param {any} [defaultValue=null]
 * @returns {any}
 */
export function getJson(key, defaultValue = null) {
  const entry = store.get(key);
  if (!entry) return defaultValue;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return defaultValue;
  }
  return entry.value;
}

/**
 * Serialise and store a value with an optional TTL in seconds.
 *
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlSeconds=600]  How many seconds before the entry expires.
 */
export function setJson(key, value, ttlSeconds = 600) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  store.set(key, { value, expiresAt });
}

/**
 * Check whether an alert message (or any key) was already sent
 * within the given `durationSeconds` window.
 *
 * @param {string} alertKey   Unique deduplication key (e.g. the alert message text).
 * @param {number} nowMs      Current epoch millisecond timestamp.
 * @param {number} durationSeconds  How long to consider the alert "recent".
 * @returns {Promise<boolean>}
 */
export async function alreadySentRecently(alertKey, nowMs, durationSeconds) {
  const sentKey = `sent:${alertKey}`;
  const existing = store.get(sentKey);
  if (existing) {
    return true;
  }
  // Mark as sent with TTL equal to the dedupe window
  store.set(sentKey, { value: true, expiresAt: nowMs + durationSeconds * 1000 });
  return false;
}

/**
 * Remove all entries from the store (useful for testing).
 */
export function clearStore() {
  store.clear();
}