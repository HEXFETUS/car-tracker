import app from '../../backend/dist/app.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const expressHandler = app as unknown as (req: VercelRequest, res: VercelResponse) => void;

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[api-catchall] ${req.method} ${req.url}`);
  return expressHandler(req, res);
}
