import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getPool } from '../db/db.js';
const router = Router();
const SALT_ROUNDS = 12;
function sanitise(row) {
    return {
        id: row.id,
        name: row.name,
        username: row.username,
        userType: row.user_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
// GET /api/users — List all users (password hash excluded)
router.get('/', async (_req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
        const data = result.rows.map(sanitise);
        res.json({ success: true, data, message: 'Users retrieved successfully' });
    }
    catch (error) {
        console.error('GET /api/users error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// POST /api/users — Create a new user (password is hashed)
router.post('/', async (req, res) => {
    const { name, username, password, userType } = req.body;
    if (!name || !username || !password || !userType) {
        res.status(400).json({
            success: false,
            data: null,
            error: 'Name, Username, Password, and User Type are required',
        });
        return;
    }
    const validTypes = ['ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER'];
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
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
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
        const result = await pool.query(`INSERT INTO users (name, username, password, user_type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [name, username, hashedPassword, userType]);
        res.status(201).json({
            success: true,
            data: sanitise(result.rows[0]),
            message: 'User created successfully',
        });
    }
    catch (error) {
        console.error('POST /api/users error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// DELETE /api/users/:id — Delete a user by ID
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const pool = getPool();
        // Check user exists
        const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
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
    }
    catch (error) {
        console.error('DELETE /api/users/:id error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
export default router;
//# sourceMappingURL=users.js.map