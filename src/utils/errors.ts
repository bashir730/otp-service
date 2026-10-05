/* ==================================================
   Error codes + AppError
   API هرگز stack trace یا اطلاعات حساس برنمی‌گرداند
   ================================================== */

export const ERROR_MESSAGES: Record<string, string> = {
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

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly extra?: Record<string, unknown>;

  constructor(code: string, status = 400, message?: string, extra?: Record<string, unknown>) {
    super(message || ERROR_MESSAGES[code] || 'Error');
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}
