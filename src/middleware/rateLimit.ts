import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../config/config';
import type { RedisService } from '../services/redis.service';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/* ==================================================
   Rate limiting — fixed window با Redis
   - هر IP: RATE_LIMIT_PER_IP در دقیقه
   - هر API Client: RATE_LIMIT_PER_CLIENT در دقیقه
   (سقف هر شماره داخل OTPService اعمال می‌شود)
   اگر Redis قطع باشد، fallback درون‌حافظه‌ای کار می‌کند
   ================================================== */

export function rateLimiter(redis: RedisService, config: AppConfig) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = req.ip || 'unknown';

      const ipCount = await redis.incrWithTtl(`rate:ip:${ip}`, 60);
      if (ipCount > config.RATE_LIMIT_PER_IP) {
        logger.warn({ ip }, 'Rate limit triggered (per IP)');
        throw new AppError('RATE_LIMITED', 429, 'Too many requests from this IP.');
      }

      if (req.clientId !== undefined) {
        const clientCount = await redis.incrWithTtl(`rate:client:${req.clientId}`, 60);
        if (clientCount > config.RATE_LIMIT_PER_CLIENT) {
          logger.warn({ clientId: req.clientId }, 'Rate limit triggered (per client)');
          throw new AppError('RATE_LIMITED', 429, 'Too many requests for this API client.');
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
