import type { AuthenticatedUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

export {};
