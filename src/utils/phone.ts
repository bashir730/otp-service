import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/* ==================================================
   Phone normalization → E.164
   پشتیبانی بین‌المللی؛ منطقه پیش‌فرض از .env
   نمونه‌ها (DEFAULT_REGION=AF):
     +937XXXXXXXX   → +937XXXXXXXX
     937XXXXXXXX     → +937XXXXXXXX
     00937XXXXXXXX   → +937XXXXXXXX
     07XXXXXXXX      → +937XXXXXXXX
   ================================================== */

/**
 * نرمال‌سازی شماره به فرمت E.164 (+digits).
 * در صورت نامعتبر بودن null برمی‌گردد (متصدی خطا INVALID_PHONE است).
 */
export function normalizePhone(raw: string, defaultRegion: string = 'AF'): string | null {
  const region = defaultRegion.toUpperCase() as CountryCode;
  if (!raw || typeof raw !== 'string') return null;

  let candidate = raw.trim();
  if (!candidate) return null;

  /* پیشوند بین‌المللی 00 → + */
  if (candidate.startsWith('00')) {
    candidate = '+' + candidate.slice(2);
  }

  /* حذف فاصله، خط تیره، پرانتز و... به‌جز + و ارقام */
  candidate = candidate.replace(/[^+0-9]/g, '');
  if (!candidate) return null;

  /* تلاش اول: با منطقه پیش‌فرض (شماره محلی مثل 07xxxxxxxx) */
  try {
    const parsed = parsePhoneNumberFromString(candidate, region);
    if (parsed && parsed.isValid()) return parsed.number;
  } catch {
    /* ادامه به تلاش دوم */
  }

  /* تلاش دوم: بدون + اما با کد کشور (مثل 937xxxxxxxx) */
  if (!candidate.startsWith('+')) {
    try {
      const parsed = parsePhoneNumberFromString('+' + candidate, region);
      if (parsed && parsed.isValid()) return parsed.number;
    } catch {
      /* نامعتبر */
    }
  }

  return null;
}
