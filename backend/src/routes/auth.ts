import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import bcrypt from 'bcrypt';
import type { AppUser } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '../security/session.js';
import { toPublicUser } from '../middleware/auth.js';
import { loginIpRateLimit, loginUsernameRateLimit } from '../middleware/rate-limit.js';

console.log('[auth-router] module loaded');
const router: ExpressRouter = express.Router();

interface UserRow {
  id: string;
  name: string;
  username: string;
  password: string;
  user_type: string;
  department: string;
  picture: string | null;
  created_at: string;
  updated_at: string;
}

function sanitise(row: UserRow): AppUser {
  const result: AppUser = {
    id: row.id,
    name: row.name,
    username: row.username,
    userType: row.user_type as AppUser['userType'],
    department: row.department,
    picture: row.picture ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return result;
}

// POST /api/auth/login — Authenticate with username + password
router.post('/login', loginIpRateLimit, loginUsernameRateLimit, async (req: Request, res: Response) => {
  console.log('[auth-login] route hit');
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Username and password are required',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<UserRow>(
      'SELECT * FROM users WHERE username = $1',
      [username],
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        data: null,
        error: 'Invalid username or password',
      });
      return;
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      res.status(401).json({
        success: false,
        data: null,
        error: 'Invalid username or password',
      });
      return;
    }

    setSessionCookie(res, createSessionToken(user.id));

    res.json({
      success: true,
      data: sanitise(user),
      message: 'Login successful',
    });
  } catch (error) {
    console.error('POST /api/auth/login error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/auth/session — Restore the current server-verified session.
router.get('/session', (req: Request, res: Response) => {
  if (!req.auth) {
    res.status(401).json({ success: false, data: null, error: 'Authentication required' });
    return;
  }
  res.json({ success: true, data: toPublicUser(req.auth) });
});

// POST /api/auth/logout — Invalidate the browser cookie.
router.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true, data: null, message: 'Logged out' });
});

export default router;
