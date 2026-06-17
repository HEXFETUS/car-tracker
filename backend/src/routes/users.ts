import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import bcrypt from 'bcrypt';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

const SALT_ROUNDS = 12;

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

// Exported type for the sanitised user (no password hash)
export interface SanitisedUser {
  id: string;
  name: string;
  username: string;
  userType: string;
  department: string;
  picture?: string;
  createdAt: string;
  updatedAt: string;
}

function sanitise(row: UserRow): SanitisedUser {
  const result: SanitisedUser = {
    id: row.id,
    name: row.name,
    username: row.username,
    userType: row.user_type,
    department: row.department,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.picture) result.picture = row.picture;
  return result;
}

// GET /api/users — List all users (password hash excluded)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<UserRow>(
      'SELECT * FROM users ORDER BY created_at DESC',
    );
    const data = result.rows.map(sanitise);
    res.json({ success: true, data, message: 'Users retrieved successfully' });
  } catch (error) {
    console.error('GET /api/users error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/users — Create a new user (password is hashed)
router.post('/', async (req: Request, res: Response) => {
  const { name, username, password, userType, department } = req.body;

  if (!name || !username || !password || !userType) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Name, Username, Password, and User Type are required',
    });
    return;
  }

  const validTypes = ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'];
  if (!validTypes.includes(userType)) {
    res.status(400).json({
      success: false,
      data: null,
      error: `User Type must be one of: ${validTypes.join(', ')}`,
    });
    return;
  }

  try {
    const pool = getPool();

    // Check duplicate username
    const existing = await pool.query<UserRow>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        data: null,
        error: 'A user with this username already exists',
      });
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query<UserRow>(
      `INSERT INTO users (name, username, password, user_type, department)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, username, hashedPassword, userType, department ?? ''],
    );

    res.status(201).json({
      success: true,
      data: sanitise(result.rows[0]),
      message: 'User created successfully',
    });
  } catch (error) {
    console.error('POST /api/users error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// PUT /api/users/:id — Update user name, username, userType, department, or picture
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, username, userType, department, picture } = req.body;

  if (!name && !username && !userType && department === undefined && picture === undefined) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'At least one field (name, username, userType, department, picture) must be provided',
    });
    return;
  }

  try {
    const pool = getPool();

    // Check user exists
    const existing = await pool.query<UserRow>(
      'SELECT id FROM users WHERE id = $1',
      [id],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'User not found',
      });
      return;
    }

    // If username is being changed, check for duplicates (excluding current user)
    if (username) {
      const dup = await pool.query<UserRow>(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, id],
      );
      if (dup.rows.length > 0) {
        res.status(409).json({
          success: false,
          data: null,
          error: 'A user with this username already exists',
        });
        return;
      }
    }

    // If userType is provided, validate it
    const validTypes = ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'];
    if (userType && !validTypes.includes(userType)) {
      res.status(400).json({
        success: false,
        data: null,
        error: `User Type must be one of: ${validTypes.join(', ')}`,
      });
      return;
    }

    // Build dynamic UPDATE query
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name) {
      fields.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (username) {
      fields.push(`username = $${paramIndex++}`);
      values.push(username);
    }
    if (userType) {
      fields.push(`user_type = $${paramIndex++}`);
      values.push(userType);
    }
    if (department !== undefined) {
      fields.push(`department = $${paramIndex++}`);
      values.push(department);
    }
    if (picture !== undefined) {
      fields.push(`picture = $${paramIndex++}`);
      values.push(picture);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query<UserRow>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    res.json({
      success: true,
      data: sanitise(result.rows[0]),
      message: 'User updated successfully',
    });
  } catch (error) {
    console.error('PUT /api/users/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// PUT /api/users/:id/password — Change user password
router.put('/:id/password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Password is required',
    });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Password must be at least 8 characters',
    });
    return;
  }

  try {
    const pool = getPool();

    // Check user exists
    const existing = await pool.query<UserRow>(
      'SELECT id FROM users WHERE id = $1',
      [id],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'User not found',
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query<UserRow>(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [hashedPassword, id],
    );

    res.json({
      success: true,
      data: sanitise(result.rows[0]),
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('PUT /api/users/:id/password error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// DELETE /api/users/:id — Delete a user by ID
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const pool = getPool();

    // Check user exists
    const existing = await pool.query<UserRow>(
      'SELECT id FROM users WHERE id = $1',
      [id],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'User not found',
      });
      return;
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      success: true,
      data: { id },
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('DELETE /api/users/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;
