import app from '../../backend/dist/app.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[api-catchall] ${req.method} ${req.url}`);
  return app(req, res);
}
