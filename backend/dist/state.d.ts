/**
 * Retrieve a previously stored JSON value.
 * Returns `defaultValue` when the key is missing or expired.
 */
export declare function getJson<T = unknown>(key: string, defaultValue?: T | null): T | null;
/**
 * Store a value under `key` with an optional TTL in seconds.
 * Default TTL is 600 seconds (10 minutes).
 */
export declare function setJson(key: string, value: unknown, ttlSeconds?: number): void;
/**
 * Check whether an alert (identified by `alertKey`) was already
 * dispatched within the given `durationSeconds` window.
 *
 * Returns `true` if the key exists and hasn't expired, otherwise
 * stores the key and returns `false`.
 */
export declare function alreadySentRecently(alertKey: string, nowMs: number, durationSeconds: number): Promise<boolean>;
/**
 * Remove all entries from the store (useful for testing / clean-up).
 */
export declare function clearStore(): void;
//# sourceMappingURL=state.d.ts.map