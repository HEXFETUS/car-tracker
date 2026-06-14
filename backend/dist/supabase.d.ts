/**
 * Returns `true` when the database client is configured and
 * ready to accept queries.
 */
export declare function isSupabaseConfigured(): boolean;
/**
 * Insert one or more telemetry alerts into the database.
 *
 * @param alerts - Array of alert objects to persist.
 * @returns Result summary with `ok` status and inserted `count`.
 */
export declare function insertAlerts(alerts: Array<{
    type?: string;
    message?: string;
    vehicle_id?: string | null;
    location?: string | null;
    speed?: number | null;
    fuel?: number | null;
}>): Promise<{
    ok: boolean;
    count: number;
    error?: string;
}>;
/**
 * Gracefully shut down the connection pool.
 * Call this during application shutdown.
 */
export declare function closePool(): Promise<void>;
//# sourceMappingURL=supabase.d.ts.map