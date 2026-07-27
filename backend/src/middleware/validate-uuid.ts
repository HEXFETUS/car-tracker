import type { NextFunction, Request, Response } from 'express';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateUuidParam(req: Request, res: Response, next: NextFunction, value: string, name: string): void {
  if (!UUID_PATTERN.test(value)) {
    res.status(400).json({ success: false, data: null, error: `Invalid ${name}` });
    return;
  }
  next();
}
