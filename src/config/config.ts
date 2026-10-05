import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';

/* .env از ریشه پروژه خوانده می‌شود */
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_PATH: z.string().default('./data/otp.sqlite'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_EXPIRES_SECONDS: z.coerce.number().int().min(30).default(300),
  OTP_RESEND_SECONDS: z.coerce.number().int().min(10).default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),

  RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_PER_PHONE: z.coerce.number().int().min(1).default(3),
  RATE_LIMIT_PER_CLIENT: z.coerce.number().int().min(1).default(60),

  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),

  DEFAULT_REGION: z.string().default('AF'),
  WHATSAPP_AUTO_CONNECT: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((v) => ['true', '1', 'yes'].includes(v)),

  ADMIN_KEY: z.string().min(8),
  OTP_PEPPER: z.string().min(16),
  OTP_MESSAGE_TEMPLATE: z.string().default(
    'Your verification code:\n{code}\n\nThis code is valid for {minutes} minutes.\nIf you did not request this, ignore this message.'
  ),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    /* eslint-disable-next-line no-console */
    console.error('❌ Invalid configuration:\n' + issues);
    process.exit(1);
  }

  const config = parsed.data;

  if (config.ADMIN_KEY === 'change-me-long-random-admin-key') {
    config.ADMIN_KEY = crypto.randomBytes(24).toString('hex');
    /* eslint-disable-next-line no-console */
    console.warn('⚠️ ADMIN_KEY not set — a random one was generated for this run only.');
  }
  if (config.OTP_PEPPER === 'change-me-long-random-pepper') {
    config.OTP_PEPPER = crypto.randomBytes(32).toString('hex');
    /* eslint-disable-next-line no-console */
    console.warn('⚠️ OTP_PEPPER not set — OTP hashes will not survive restarts.');
  }

  return config;
}
