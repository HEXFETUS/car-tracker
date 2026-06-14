import pg from 'pg';
/**
 * Return the shared application pool.
 * Creates it lazily on first call.
 */
export declare function getPool(): pg.Pool;
/**
 * Gracefully shut down the pool (call during app shutdown).
 */
export declare function closePool(): Promise<void>;
//# sourceMappingURL=db.d.ts.map