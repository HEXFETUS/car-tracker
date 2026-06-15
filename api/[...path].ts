import app from '../backend/dist/app.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[vercel-entry]', req.method, req.url);
  return app(req, res);
}