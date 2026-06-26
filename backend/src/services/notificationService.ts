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

export async function createNotification(input: CreateNotificationInput) {
  const pool = getPool();
  const result = await pool.query<NotificationRow>(
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
  return mapNotification(result.rows[0]);
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

export async function listNotifications(userId: string) {
  const pool = getPool();
  const result = await pool.query<NotificationRow>(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  return result.rows.map(mapNotification);
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
