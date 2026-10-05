"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
const otp_1 = require("../utils/otp");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
function apiKeyAuth(db) {
    return (req, _res, next) => {
        try {
            const authHeader = req.headers.authorization || '';
            const match = /^Bearer\s+(.+)$/i.exec(authHeader);
            if (!match) {
                throw new errors_1.AppError('UNAUTHORIZED', 401);
            }
            const key = match[1].trim();
            const keyHash = (0, otp_1.hashApiKey)(key);
            /* lookup مستقیم — غیرفعال‌سازی client بلافاصله اعمال می‌شود */
            const client = db.findClientByHash(keyHash);
            if (!client) {
                logger_1.logger.warn({ ip: req.ip }, 'Invalid API key used');
                throw new errors_1.AppError('UNAUTHORIZED', 401);
            }
            if (!client.active) {
                throw new errors_1.AppError('CLIENT_INACTIVE', 403);
            }
            req.clientId = client.id;
            req.clientName = client.name;
            return next();
        }
        catch (err) {
            next(err);
        }
    };
}
