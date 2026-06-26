import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService.js';

const router: ExpressRouter = express.Router();

function getUserId(req: Request, res: Response): string | null {
  const userId = req.headers['x-user-id'];
  if (typeof userId === 'string' && userId.length > 0) return userId;
  res.status(401).json({ success: false, data: null, error: 'Authentication required' });
  return null;
}

router.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  try {
    res.json({ success: true, data: await listNotifications(userId) });
  } catch (error) {
    console.error('GET /api/notifications error:', (error as Error).message);
    res.status(500).json({ success: false, data: [], error: 'Database error' });
  }
});

router.get('/unread-count', async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  try {
    res.json({ success: true, data: { count: await getUnreadNotificationCount(userId) } });
  } catch (error) {
    console.error('GET /api/notifications/unread-count error:', (error as Error).message);
    res.status(500).json({ success: false, data: { count: 0 }, error: 'Database error' });
  }
});

router.patch('/read-all', async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  try {
    await markAllNotificationsRead(userId);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error('PATCH /api/notifications/read-all error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.patch('/:id/read', async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  try {
    await markNotificationRead(userId, req.params.id);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error('PATCH /api/notifications/:id/read error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;
