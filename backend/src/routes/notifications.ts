import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService.js';

const router: ExpressRouter = express.Router();
import { validateUuidParam } from '../middleware/validate-uuid.js';

router.param('id', validateUuidParam);

router.get('/', async (req: Request, res: Response) => {
  const userId = req.auth!.id;

  const requestedPage = Number(req.query.page ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  try {
    const result = await listNotifications(userId, page);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('GET /api/notifications error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: [],
      total: 0,
      page,
      pageSize: 20,
      hasMore: false,
      error: 'Database error',
    });
  }
});

router.get('/unread-count', async (req: Request, res: Response) => {
  const userId = req.auth!.id;

  try {
    res.json({ success: true, data: { count: await getUnreadNotificationCount(userId) } });
  } catch (error) {
    console.error('GET /api/notifications/unread-count error:', (error as Error).message);
    res.status(500).json({ success: false, data: { count: 0 }, error: 'Database error' });
  }
});

router.patch('/read-all', async (req: Request, res: Response) => {
  const userId = req.auth!.id;

  try {
    await markAllNotificationsRead(userId);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error('PATCH /api/notifications/read-all error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.patch('/:id/read', async (req: Request, res: Response) => {
  const userId = req.auth!.id;

  try {
    await markNotificationRead(userId, req.params.id);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error('PATCH /api/notifications/:id/read error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;
