import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ERROR_MESSAGES } from '../utils/errors';
import { logger } from '../utils/logger';

/* ==================================================
   Error handler مرکزی
   - هیچ stack trace یا اطلاعات حساس به کاربر نمی‌رسد
   - خطایINTERNAL با جزئیات کامل سمت سرور log می‌شود
   - برای خطاهای OTP فیلد verified:false هم برمی‌گردد
   ================================================== */

const OTP_ERROR_CODES = new Set(['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS']);

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: 'NOT_FOUND', message: ERROR_MESSAGES.NOT_FOUND });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  /* خطای Zod → validation error امن */
  if (err instanceof ZodError) {
    const phoneIssue = err.issues.find((i) => i.path.includes('phone'));
    const code = phoneIssue ? 'INVALID_PHONE' : 'VALIDATION_ERROR';
    res.status(400).json({ success: false, error: code, message: ERROR_MESSAGES[code] });
    return;
  }

  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      success: false,
      error: err.code,
      message: err.message
    };
    if (OTP_ERROR_CODES.has(err.code)) body.verified = false;
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.status).json(body);
    return;
  }

  /* خطای JSON parse بدنه */
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: ERROR_MESSAGES.VALIDATION_ERROR
    });
    return;
  }

  /* خطای ناشناخته — log کامل سمت سرور، پاسخ عمومی به کاربر */
  logger.error(
    {
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      path: req.path,
      method: req.method
    },
    'Unhandled error'
  );
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: ERROR_MESSAGES.INTERNAL_ERROR
  });
}
