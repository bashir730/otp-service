import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createApiRouter, type AppDeps } from './routes/otp.routes';
import { createHealthRouter } from './routes/health.routes';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

/* ==================================================
   createApp — برای تست‌پذیری، dependencies تزریق می‌شوند
   ================================================== */

export function createApp(deps: AppDeps): Express {
  const app = express();

  /* امنیت */
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: deps.config.CORS_ORIGIN === '*' ? true : deps.config.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
    })
  );

  /* بدنه JSON محدود — جلوگیری از payload بزرگ */
  app.use(express.json({ limit: '16kb' }));

  /* صفحه ریشه — معرفی سرویس */
  app.get('/', (_req, res) => {
    res.json({
      service: 'otp-service',
      version: '1.0.0',
      health: '/api/v1/health'
    });
  });

  /* مسیرهای API */
  app.use('/api/v1/health', createHealthRouter(deps));
  app.use('/api/v1', createApiRouter(deps));

  /* 404 + error handler */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
