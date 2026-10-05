"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = rateLimiter;
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
/* ==================================================
   Rate limiting — fixed window با Redis
   - هر IP: RATE_LIMIT_PER_IP در دقیقه
   - هر API Client: RATE_LIMIT_PER_CLIENT در دقیقه
   (سقف هر شماره داخل OTPService اعمال می‌شود)
   اگر Redis قطع باشد، fallback درون‌حافظه‌ای کار می‌کند
   ================================================== */
function rateLimiter(redis, config) {
    return async (req, _res, next) => {
        try {
            const ip = req.ip || 'unknown';
            const ipCount = await redis.incrWithTtl(`rate:ip:${ip}`, 60);
            if (ipCount > config.RATE_LIMIT_PER_IP) {
                logger_1.logger.warn({ ip }, 'Rate limit triggered (per IP)');
                throw new errors_1.AppError('RATE_LIMITED', 429, 'Too many requests from this IP.');
            }
            if (req.clientId !== undefined) {
                const clientCount = await redis.incrWithTtl(`rate:client:${req.clientId}`, 60);
                if (clientCount > config.RATE_LIMIT_PER_CLIENT) {
                    logger_1.logger.warn({ clientId: req.clientId }, 'Rate limit triggered (per client)');
                    throw new errors_1.AppError('RATE_LIMITED', 429, 'Too many requests for this API client.');
                }
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
