"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const config_1 = require("./config/config");
const logger_1 = require("./utils/logger");
const database_service_1 = require("./database/database.service");
const redis_service_1 = require("./services/redis.service");
const whatsapp_service_1 = require("./services/whatsapp.service");
const otp_service_1 = require("./services/otp.service");
const app_1 = require("./app");
const backup_1 = require("./scripts/backup");
/* ==================================================
   server.ts — نقطه ورود
   ================================================== */
async function main() {
    const config = (0, config_1.loadConfig)();
    /* ---------- بازیابی session/dB از GitHub (دیسک موقتی مثل Render) ---------- */
    const backup = backup_1.GitHubBackup.fromEnv();
    if (backup) {
        await backup.restoreIfEmpty();
        backup.start();
    }
    /* ---------- services ---------- */
    const db = new database_service_1.DatabaseService(config.DATABASE_PATH);
    db.init();
    const redis = new redis_service_1.RedisService(config.REDIS_URL);
    redis.connect();
    const whatsapp = new whatsapp_service_1.WhatsAppService('./auth/baileys-session');
    const otp = new otp_service_1.OTPService(db, redis, whatsapp, config);
    /* ---------- app ---------- */
    const app = (0, app_1.createApp)({ config, db, redis, whatsapp, otp });
    const server = http_1.default.createServer(app);
    server.listen(config.PORT, () => {
        logger_1.logger.info({ port: config.PORT, env: config.NODE_ENV }, `🚀 otp-service listening on port ${config.PORT}`);
        logger_1.logger.info({ health: `http://localhost:${config.PORT}/api/v1/health` }, 'Health check available');
    });
    /* اتصال WhatsApp — QR در terminal نمایش داده می‌شود */
    if (config.WHATSAPP_AUTO_CONNECT) {
        whatsapp.connect().catch((err) => {
            logger_1.logger.error({ err: err.message }, 'Initial WhatsApp connect failed');
        });
    }
    /* پشتیبان‌گیری بعد از هر اتصال موفق — session تازه ذخیره می‌شود */
    whatsapp.onConnected(() => {
        if (backup)
            void backup.backupNow('connected');
    });
    /* ---------- graceful shutdown ---------- */
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger_1.logger.info({ signal }, 'Graceful shutdown started');
        const forceExit = setTimeout(() => {
            logger_1.logger.error('Forced exit after shutdown timeout');
            process.exit(1);
        }, 10_000);
        forceExit.unref();
        if (backup)
            await backup.backupNow('shutdown');
        try {
            await new Promise((resolve) => {
                server.close(() => resolve());
                /* اگر connection باز نباشد، server.close فوراً resolve نمی‌شود */
                setTimeout(() => resolve(), 2000);
            });
            await whatsapp.end();
            await redis.quit();
            db.close();
            logger_1.logger.info('Graceful shutdown complete');
            process.exit(0);
        }
        catch (err) {
            logger_1.logger.error({ err: err.message }, 'Error during shutdown');
            process.exit(1);
        }
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGQUIT', () => void shutdown('SIGQUIT'));
    /* خطاهای غیرمنتظره — crash با log کنترل‌شده */
    process.on('unhandledRejection', (reason) => {
        logger_1.logger.error({ reason: String(reason) }, 'Unhandled rejection');
    });
    process.on('uncaughtException', (err) => {
        logger_1.logger.error({ err: { message: err.message, stack: err.stack } }, 'Unhandled exception — shutting down');
        void shutdown('uncaughtException');
    });
}
main().catch((err) => {
    logger_1.logger.error({ err: err.message }, 'Fatal startup error');
    process.exit(1);
});
