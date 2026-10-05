import { Router } from 'express';
import type { AppDeps } from './otp.routes';

/* ==================================================
   Health — GET /api/v1/health
   حتی وقتی WhatsApp یا Redis قطع است، process crash نمی‌کند
   ================================================== */

export function createHealthRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const whatsapp = deps.whatsapp.getState(); // connected | connecting | disconnected | logged_out
    const redisOk = deps.redis.isConnected() || (await deps.redis.ping());
    const dbOk = deps.db.isConnected();

    const ok = dbOk; /* دیتابیس حیاتی است؛ redis fallback دارد و whatsapp می‌تواند دیرتر وصل شود */

    res.status(ok ? 200 : 503).json({
      status: ok ? (whatsapp === 'connected' && redisOk ? 'ok' : 'degraded') : 'error',
      whatsapp,
      redis: redisOk ? 'connected' : 'disconnected',
      database: dbOk ? 'connected' : 'disconnected',
      time: new Date().toISOString()
    });
  });

  return router;
}
