import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from '../backend/dist/app.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[vercel-entry]', req.method, req.url);
  return (app as unknown as (req: VercelRequest, res: VercelResponse) => void)(req, res);
}
