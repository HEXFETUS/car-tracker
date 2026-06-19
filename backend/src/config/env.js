// ── Environment Configuration ─────────────────────────────────
//
// Centralised, typed access to all environment variables used
// across the backend. Every value is read once at import time.
/**
 * Normalise a string env value, trimming quotes that .env files
 * sometimes carry.
 */
function str(key, fallback = '') {
    const raw = process.env[key];
    if (!raw)
        return fallback;
    return raw.replace(/^["']|["']$/g, '').trim();
}
function num(key, fallback) {
    const parsed = Number(str(key));
    return Number.isFinite(parsed) ? parsed : fallback;
}
// ── System / Server ───────────────────────────────────────────
export const PORT = num('PORT', 3500);
// ── Telegram ──────────────────────────────────────────────────
export const BOT_TOKEN = str('BOT_TOKEN');
export const CHAT_ID = str('CHAT_ID');
// ── Cartrack ──────────────────────────────────────────────────
export const CARTRACK_USERNAME = str('CARTRACK_USERNAME');
export const CARTRACK_PASSWORD = str('CARTRACK_PASSWORD');
export const CARTRACK_API_URL = str('CARTRACK_API_URL');
export const SYNC_INTERVAL_SECONDS = num('SYNC_INTERVAL_SECONDS', 120);
export const CRON_SECRET = str('CRON_SECRET');
// ── Database (Supabase / PostgreSQL) ──────────────────────────
export const DATABASE_URL = str('DATABASE_URL');
// ── Convenience helpers ───────────────────────────────────────
export const telegramConfigured = () => Boolean(BOT_TOKEN && CHAT_ID);
export const cartrackConfigured = () => Boolean(CARTRACK_USERNAME && CARTRACK_PASSWORD && CARTRACK_API_URL);
//# sourceMappingURL=env.js.map