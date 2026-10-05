import type { Request, Response, NextFunction } from 'express';
import type { DatabaseService } from '../database/database.service';
import { hashApiKey } from '../utils/otp';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/* ==================================================
   API Key authentication — Authorization: Bearer <key>
   کلید خام هرگز log نمی‌شود؛ فقط hash آن مقایسه می‌شود
   ================================================== */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clientId?: number;
      clientName?: string;
    }
  }
}

export function apiKeyAuth(db: DatabaseService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const authHeader = req.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);

      if (!match) {
        throw new AppError('UNAUTHORIZED', 401);
      }

      const key = match[1].trim();
      const keyHash = hashApiKey(key);

      /* lookup مستقیم — غیرفعال‌سازی client بلافاصله اعمال می‌شود */
      const client = db.findClientByHash(keyHash);
      if (!client) {
        logger.warn({ ip: req.ip }, 'Invalid API key used');
        throw new AppError('UNAUTHORIZED', 401);
      }
      if (!client.active) {
        throw new AppError('CLIENT_INACTIVE', 403);
      }

      req.clientId = client.id;
      req.clientName = client.name;
      return next();
    } catch (err) {
      next(err);
    }
  };
}
