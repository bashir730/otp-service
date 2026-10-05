import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { OTPService } from '../services/otp.service';
import type { AppConfig } from '../config/config';
import { normalizePhone } from '../utils/phone';
import { AppError } from '../utils/errors';

/* ==================================================
   OTP Controller — validation با Zod + مدیریت خطا
   ================================================== */

const sendSchema = z.object({
  phone: z.string().min(5).max(20),
  purpose: z.string().trim().min(2).max(50).default('login')
});

const verifySchema = z.object({
  phone: z.string().min(5).max(20),
  code: z.string().regex(/^\d{4,8}$/, 'invalid code'),
  purpose: z.string().trim().min(2).max(50).default('login')
});

export class OTPController {
  constructor(
    private readonly otp: OTPService,
    private readonly config: AppConfig
  ) {}

  /* POST /api/v1/otp/send */
  async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = sendSchema.parse(req.body || {});
      const phone = normalizePhone(body.phone, this.config.DEFAULT_REGION);
      if (!phone) throw new AppError('INVALID_PHONE', 400);

      const result = await this.otp.sendOTP(req.clientId!, phone, body.purpose, req.ip || null);

      /* کد خام در response برنمی‌گردد (کلاینت فقط وضعیت می‌خواهد) */
      res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        expiresIn: result.expiresIn
      });
    } catch (err) {
      next(err);
    }
  }

  /* POST /api/v1/otp/verify */
  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = verifySchema.parse(req.body || {});
      const phone = normalizePhone(body.phone, this.config.DEFAULT_REGION);
      if (!phone) throw new AppError('INVALID_PHONE', 400);

      await this.otp.verifyOTP(req.clientId!, phone, body.purpose, body.code, req.ip || null);

      res.status(200).json({ success: true, verified: true });
    } catch (err) {
      next(err);
    }
  }
}
