"use strict";
/* ==================================================
   Error codes + AppError
   API هرگز stack trace یا اطلاعات حساس برنمی‌گرداند
   ================================================== */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = exports.ERROR_MESSAGES = void 0;
exports.ERROR_MESSAGES = {
    INVALID_PHONE: 'The phone number is invalid.',
    VALIDATION_ERROR: 'Invalid request payload.',
    OTP_SEND_FAILED: 'Failed to send the OTP message.',
    OTP_EXPIRED: 'The verification code has expired.',
    INVALID_OTP: 'The verification code is invalid or expired.',
    TOO_MANY_ATTEMPTS: 'Too many verification attempts. Please request a new code.',
    RATE_LIMITED: 'Too many requests. Please try again later.',
    UNAUTHORIZED: 'Missing or invalid API key.',
    WHATSAPP_NOT_READY: 'WhatsApp connection is not ready. Please try again shortly.',
    CLIENT_EXISTS: 'A client with this name already exists.',
    CLIENT_INACTIVE: 'API client is inactive.',
    NOT_FOUND: 'Resource not found.',
    INTERNAL_ERROR: 'An internal error occurred.'
};
class AppError extends Error {
    code;
    status;
    extra;
    constructor(code, status = 400, message, extra) {
        super(message || exports.ERROR_MESSAGES[code] || 'Error');
        this.name = 'AppError';
        this.code = code;
        this.status = status;
        this.extra = extra;
    }
}
exports.AppError = AppError;
