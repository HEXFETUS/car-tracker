// Use the same verified TLS identity as the backend application pool.
export function getDatabaseConfig() {
  const connectionString = (process.env.DATABASE_URL || '').replace(/^["']|["']$/g, '').trim();
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (process.env.NODE_ENV === 'production' && !ca) {
    throw new Error('DATABASE_CA_CERT is required for production PostgreSQL connections');
  }
  return {
    connectionString,
    ...(ca ? { ssl: {
      ca,
      rejectUnauthorized: true,
      host: new URL(connectionString).hostname.replace(/^\[|\]$/g, ''),
    } } : {}),
  };
}
