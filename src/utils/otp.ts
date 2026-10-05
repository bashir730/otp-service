import crypto from 'crypto';

/* ==================================================
   OTP utilities
   - تولید cryptographically secure
   - hash با HMAC-SHA256 + pepper
   OTP خام هرگز ذخیره یا log نمی‌شود
   ================================================== */

/** تولید کد OTP امن با crypto.randomInt (کریپتوگرافیک) */
export function generateOTP(length: number): string {
  const digits: string[] = [];
  for (let i = 0; i < length; i++) {
    digits.push(crypto.randomInt(0, 10).toString());
  }
  return digits.join('');
}

/** hash OTP با HMAC-SHA256 و pepper — برگشت‌پذیر نیست */
export function hashOTP(code: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(code).digest('hex');
}

/** تولید API Key جدید — فقط hash آن ذخیره می‌شود */
export function generateApiKey(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16) || 'CLIENT';
  const secret = crypto.randomBytes(24).toString('hex');
  return `OTPS_${slug}_${secret}`;
}

/** hash API Key — sha256 کافی است چون کلید با آنتروپی بالا تولید می‌شود */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}
