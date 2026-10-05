"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
/* ==================================================
   Error handler مرکزی
   - هیچ stack trace یا اطلاعات حساس به کاربر نمی‌رسد
   - خطایINTERNAL با جزئیات کامل سمت سرور log می‌شود
   - برای خطاهای OTP فیلد verified:false هم برمی‌گردد
   ================================================== */
const OTP_ERROR_CODES = new Set(['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS']);
function notFoundHandler(_req, res) {
    res.status(404).json({ success: false, error: 'NOT_FOUND', message: errors_1.ERROR_MESSAGES.NOT_FOUND });
}
function errorHandler(err, req, res, _next) {
    /* خطای Zod → validation error امن */
    if (err instanceof zod_1.ZodError) {
        const phoneIssue = err.issues.find((i) => i.path.includes('phone'));
        const code = phoneIssue ? 'INVALID_PHONE' : 'VALIDATION_ERROR';
        res.status(400).json({ success: false, error: code, message: errors_1.ERROR_MESSAGES[code] });
        return;
    }
    if (err instanceof errors_1.AppError) {
        const body = {
            success: false,
            error: err.code,
            message: err.message
        };
        if (OTP_ERROR_CODES.has(err.code))
            body.verified = false;
        if (err.extra)
            Object.assign(body, err.extra);
        res.status(err.status).json(body);
        return;
    }
    /* خطای JSON parse بدنه */
    if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({
            success: false,
            error: 'VALIDATION_ERROR',
            message: errors_1.ERROR_MESSAGES.VALIDATION_ERROR
        });
        return;
    }
    /* خطای ناشناخته — log کامل سمت سرور، پاسخ عمومی به کاربر */
    logger_1.logger.error({
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
        path: req.path,
        method: req.method
    }, 'Unhandled error');
    res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: errors_1.ERROR_MESSAGES.INTERNAL_ERROR
    });
}
