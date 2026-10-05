import type { AppConfig } from '../config/config';
import type { DatabaseService } from '../database/database.service';
import type { RedisService } from './redis.service';
import { generateOTP, hashOTP } from '../utils/otp';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/* ==================================================
   OTPService — تمام منطق OTP
   جریان: OTPService → WhatsAppService → Baileys
   (این کلاس فقط با اینترفیس WhatsAppSender کار می‌کند؛
    عوض کردن provider نیازمند تغییر OTPService نیست)
   ================================================== */

export interface WhatsAppSender {
  sendMessage(phone: string, message: string): Promise<void>;
  isConnected(): boolean;
}

export interface SendOtpResult {
  code: string;
  expiresIn: number;
}

export class OTPService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly wa: WhatsAppSender,
    private readonly config: AppConfig
  ) {}

  /* ---------- تولید (cryptographically secure) ---------- */
  generateOTP(): string {
    return generateOTP(this.config.OTP_LENGTH);
  }

  /** قالب پیام از configuration */
  private buildMessage(code: string): string {
    const minutes = Math.max(1, Math.ceil(this.config.OTP_EXPIRES_SECONDS / 60));
    return this.config.OTP_MESSAGE_TEMPLATE
      .replace(/\{code\}/g, code)
      .replace(/\{minutes\}/g, String(minutes));
  }

  /* ---------- ساخت OTP جدید ---------- */
  async createOTP(clientId: number, phone: string, purpose: string): Promise<SendOtpResult> {
    /* 1) پنجره resend — حداکثر ۱ OTP هر OTP_RESEND_SECONDS ثانیه */
    const waitKey = `otp:wait:${phone}:${purpose}`;
    const remaining = await this.redis.ttl(waitKey);
    if (remaining > 0) {
      throw new AppError('RATE_LIMITED', 429, `Please wait ${remaining}s before requesting a new code.`, {
        retryAfter: remaining
      });
    }

    /* 2) سقف درخواست در دقیقه برای هر شماره */
    const phoneCount = await this.redis.incrWithTtl(`rate:phone:${phone}`, 60);
    if (phoneCount > this.config.RATE_LIMIT_PER_PHONE) {
      throw new AppError('RATE_LIMITED', 429, 'Too many OTP requests for this phone number.');
    }

    /* 3) باطل کردن OTPهای قبلی همان شماره/هدف */
    this.db.invalidatePrevious(clientId, phone, purpose);

    /* 4) تولید + hash (OTP خام هرگز ذخیره نمی‌شود) */
    const code = this.generateOTP();
    const otpHash = hashOTP(code, this.config.OTP_PEPPER);

    const expiresAt = new Date(Date.now() + this.config.OTP_EXPIRES_SECONDS * 1000).toISOString();
    this.db.createOtpRequest(clientId, phone, purpose, otpHash, expiresAt);

    /* وضعیت pending در Redis با TTL همان عمر OTP — بدون کد خام */
    await this.redis.set(`otp:${phone}:${purpose}`, 'pending', this.config.OTP_EXPIRES_SECONDS);

    return { code, expiresIn: this.config.OTP_EXPIRES_SECONDS };
  }

  /* ---------- ارسال OTP از طریق WhatsApp ---------- */
  async sendOTP(clientId: number, phone: string, purpose: string, ip: string | null): Promise<SendOtpResult> {
    const { code, expiresIn } = await this.createOTP(clientId, phone, purpose);
    const message = this.buildMessage(code);

    try {
      await this.wa.sendMessage(phone, message);
    } catch (err) {
      if (err instanceof AppError) {
        this.db.log(clientId, phone, 'otp_send', 'failed', ip);
        throw err; /* WHATSAPP_NOT_READY یا OTP_SEND_FAILED */
      }
      this.db.log(clientId, phone, 'otp_send', 'failed', ip);
      throw new AppError('OTP_SEND_FAILED', 502);
    }

    /* پنجره resend بعد از ارسال موفق فعال می‌شود */
    await this.redis.set(`otp:wait:${phone}:${purpose}`, '1', this.config.OTP_RESEND_SECONDS);

    logger.info({ phone, purpose }, 'OTP sent'); /* بدون کد خام */
    this.db.log(clientId, phone, 'otp_send', 'success', ip);
    return { code, expiresIn };
  }

  /* ---------- verify ---------- */
  async verifyOTP(
    clientId: number,
    phone: string,
    purpose: string,
    code: string,
    ip: string | null
  ): Promise<{ verified: boolean }> {
    const record = this.db.findActiveOtp(clientId, phone, purpose);

    if (!record) {
      this.db.log(clientId, phone, 'otp_verify', 'invalid', ip);
      throw new AppError('INVALID_OTP', 400);
    }

    /* انقضا */
    if (Date.now() > new Date(record.expires_at).getTime()) {
      this.db.markInvalidated(record.id);
      this.db.log(clientId, phone, 'otp_verify', 'expired', ip);
      throw new AppError('OTP_EXPIRED', 400);
    }

    /* سقف تلاشها — ضد brute-force */
    if (record.attempts >= this.config.OTP_MAX_ATTEMPTS) {
      this.db.markInvalidated(record.id);
      this.db.log(clientId, phone, 'otp_verify', 'too_many_attempts', ip);
      throw new AppError('TOO_MANY_ATTEMPTS', 429);
    }

    /* مقایسه hash */
    const providedHash = hashOTP(code, this.config.OTP_PEPPER);
    if (providedHash !== record.otp_hash) {
      const attempts = this.db.incrementAttempts(record.id);
      const left = this.config.OTP_MAX_ATTEMPTS - attempts;
      this.db.log(clientId, phone, 'otp_verify', 'invalid', ip);
      logger.warn({ phone, purpose, attempts }, 'OTP verification failed');
      if (left <= 0) {
        /* رکورد active می‌ماند تا درخواست‌های بعدی هم TOO_MANY_ATTEMPTS بگیرند
           و با انقضای خودش پاک شود */
        throw new AppError('TOO_MANY_ATTEMPTS', 429, undefined, { attemptsLeft: 0 });
      }
      throw new AppError('INVALID_OTP', 400);
    }

    /* مصرف OTP — فقط یک‌بار قابل استفاده (ضد replay) */
    this.db.markVerified(record.id);
    await this.redis.del(`otp:${phone}:${purpose}`, `otp:wait:${phone}:${purpose}`);
    this.db.log(clientId, phone, 'otp_verify', 'success', ip);
    logger.info({ phone, purpose }, 'OTP verification success');
    return { verified: true };
  }

  /* ---------- باطل کردن دستی ---------- */
  async invalidateOTP(clientId: number, phone: string, purpose: string): Promise<void> {
    this.db.invalidatePrevious(clientId, phone, purpose);
    await this.redis.del(`otp:${phone}:${purpose}`, `otp:wait:${phone}:${purpose}`);
  }
}
