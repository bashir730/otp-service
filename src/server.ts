import http from 'http';
import { loadConfig } from './config/config';
import { logger } from './utils/logger';
import { DatabaseService } from './database/database.service';
import { RedisService } from './services/redis.service';
import { WhatsAppService } from './services/whatsapp.service';
import { OTPService } from './services/otp.service';
import { createApp } from './app';
import { GitHubBackup } from './scripts/backup';

/* ==================================================
   server.ts — نقطه ورود
   ================================================== */

async function main(): Promise<void> {
  const config = loadConfig();

  /* ---------- بازیابی session/dB از GitHub (دیسک موقتی مثل Render) ---------- */
  const backup = GitHubBackup.fromEnv();
  if (backup) {
    await backup.restoreIfEmpty();
    backup.start();
  }

  /* ---------- services ---------- */
  const db = new DatabaseService(config.DATABASE_PATH);
  db.init();

  const redis = new RedisService(config.REDIS_URL);
  redis.connect();

  const whatsapp = new WhatsAppService('./auth/baileys-session');

  const otp = new OTPService(db, redis, whatsapp, config);

  /* ---------- app ---------- */
  const app = createApp({ config, db, redis, whatsapp, otp });
  const server = http.createServer(app);

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, `🚀 otp-service listening on port ${config.PORT}`);
    logger.info({ health: `http://localhost:${config.PORT}/api/v1/health` }, 'Health check available');
  });

  /* اتصال WhatsApp — QR در terminal نمایش داده می‌شود */
  if (config.WHATSAPP_AUTO_CONNECT) {
    whatsapp.connect().catch((err) => {
      logger.error({ err: (err as Error).message }, 'Initial WhatsApp connect failed');
    });
  }

  /* پشتیبان‌گیری بعد از هر اتصال موفق — session تازه ذخیره می‌شود */
  whatsapp.onConnected(() => {
    if (backup) void backup.backupNow('connected');
  });

  /* ---------- graceful shutdown ---------- */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');

    const forceExit = setTimeout(() => {
      logger.error('Forced exit after shutdown timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    if (backup) await backup.backupNow('shutdown');
    try {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        /* اگر connection باز نباشد، server.close فوراً resolve نمی‌شود */
        setTimeout(() => resolve(), 2000);
      });
      await whatsapp.end();
      await redis.quit();
      db.close();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGQUIT', () => void shutdown('SIGQUIT'));

  /* خطاهای غیرمنتظره — crash با log کنترل‌شده */
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err: { message: err.message, stack: err.stack } }, 'Unhandled exception — shutting down');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Fatal startup error');
  process.exit(1);
});
