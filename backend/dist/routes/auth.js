import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getPool } from '../db/db.js';
const router = Router();
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
// POST /api/auth/login — Authenticate with username + password
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
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
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
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
        res.json({
            success: true,
            data: sanitise(user),
            message: 'Login successful',
        });
    }
    catch (error) {
        console.error('POST /api/auth/login error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
export default router;
//# sourceMappingURL=auth.js.map