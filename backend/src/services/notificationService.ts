import { getPool } from '../db/db.js';

export type NotificationType = 'gps_alert' | 'travel_request' | 'announcement' | 'system';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  targetUrl: string;
  targetTab?: string | null;
  entityId?: string | null;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  target_url: string;
  target_tab: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

function mapNotification(row: NotificationRow) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    targetUrl: row.target_url,
    targetTab: row.target_tab ?? undefined,
    entityId: row.entity_id ?? undefined,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

const MAX_NOTIFICATIONS_PER_USER = 100;

export async function createNotification(input: CreateNotificationInput) {
  const pool = getPool();
  const client = await pool.connect();
  console.log(`[notifications] Before INSERT notification user=${input.userId} type=${input.type} entity=${input.entityId ?? 'null'}`);
  try {
    await client.query('BEGIN');

    // Serialize notification creation for this user so concurrent inserts
    // cannot leave more than the configured maximum.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.userId]);

    const result = await client.query<NotificationRow>(
      `INSERT INTO notifications
         (user_id, type, title, message, target_url, target_tab, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.userId,
        input.type,
        input.title,
        input.message,
        input.targetUrl,
        input.targetTab ?? null,
        input.entityId ?? null,
      ],
    );

    const cleanupResult = await client.query(
      `DELETE FROM notifications
       WHERE user_id = $1
         AND id IN (
           SELECT id
           FROM notifications
           WHERE user_id = $1
           ORDER BY created_at DESC, id DESC
           OFFSET $2
         )`,
      [input.userId, MAX_NOTIFICATIONS_PER_USER],
    );

    await client.query('COMMIT');
    console.log(`[notifications] INSERT notification succeeded id=${result.rows[0]?.id}`);
    if ((cleanupResult.rowCount ?? 0) > 0) {
      console.log(
        `[notifications] Deleted ${cleanupResult.rowCount} old notification(s) for user=${input.userId}`,
      );
    }
    return mapNotification(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[notifications] INSERT notification failed: ${message}`);
    throw error;
  } finally {
    client.release();
  }
}

export async function createNotificationForRoles(
  userTypes: string[],
  input: Omit<CreateNotificationInput, 'userId'>,
) {
  const pool = getPool();
  const users = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE user_type = ANY($1::text[])`,
    [userTypes],
  );

  await Promise.all(users.rows.map((user) => createNotification({ ...input, userId: user.id })));
}

const NOTIFICATION_PAGE_SIZE = 20;

export async function listNotifications(userId: string, page: number) {
  const pool = getPool();
  const offset = (page - 1) * NOTIFICATION_PAGE_SIZE;
  const [notifications, countResult] = await Promise.all([
    pool.query<NotificationRow>(
      `SELECT *
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, NOTIFICATION_PAGE_SIZE, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const total = Number(countResult.rows[0]?.count ?? 0);

  return {
    data: notifications.rows.map(mapNotification),
    total,
    page,
    pageSize: NOTIFICATION_PAGE_SIZE,
    hasMore: offset + notifications.rows.length < total,
  };
}

export async function getUnreadNotificationCount(userId: string) {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function markNotificationRead(userId: string, id: string) {
  const pool = getPool();
  await pool.query(
    `UPDATE notifications
     SET is_read = true, read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

export async function markAllNotificationsRead(userId: string) {
  const pool = getPool();
  await pool.query(
    `UPDATE notifications
     SET is_read = true, read_at = COALESCE(read_at, NOW())
     WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
}
