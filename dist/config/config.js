"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
/* .env از ریشه پروژه خوانده می‌شود */
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: zod_1.z.string().default('./data/otp.sqlite'),
    REDIS_URL: zod_1.z.string().default('redis://localhost:6379'),
    OTP_LENGTH: zod_1.z.coerce.number().int().min(4).max(8).default(6),
    OTP_EXPIRES_SECONDS: zod_1.z.coerce.number().int().min(30).default(300),
    OTP_RESEND_SECONDS: zod_1.z.coerce.number().int().min(10).default(60),
    OTP_MAX_ATTEMPTS: zod_1.z.coerce.number().int().min(1).default(5),
    RATE_LIMIT_PER_IP: zod_1.z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_PER_PHONE: zod_1.z.coerce.number().int().min(1).default(3),
    RATE_LIMIT_PER_CLIENT: zod_1.z.coerce.number().int().min(1).default(60),
    CORS_ORIGIN: zod_1.z.string().default('*'),
    LOG_LEVEL: zod_1.z.string().default('info'),
    DEFAULT_REGION: zod_1.z.string().default('AF'),
    WHATSAPP_AUTO_CONNECT: zod_1.z
        .enum(['true', 'false', '1', '0', 'yes', 'no'])
        .default('true')
        .transform((v) => ['true', '1', 'yes'].includes(v)),
    ADMIN_KEY: zod_1.z.string().min(8),
    OTP_PEPPER: zod_1.z.string().min(16),
    OTP_MESSAGE_TEMPLATE: zod_1.z.string().default('Your verification code:\n{code}\n\nThis code is valid for {minutes} minutes.\nIf you did not request this, ignore this message.'),
});
function loadConfig() {
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
        config.ADMIN_KEY = crypto_1.default.randomBytes(24).toString('hex');
        /* eslint-disable-next-line no-console */
        console.warn('⚠️ ADMIN_KEY not set — a random one was generated for this run only.');
    }
    if (config.OTP_PEPPER === 'change-me-long-random-pepper') {
        config.OTP_PEPPER = crypto_1.default.randomBytes(32).toString('hex');
        /* eslint-disable-next-line no-console */
        console.warn('⚠️ OTP_PEPPER not set — OTP hashes will not survive restarts.');
    }
    return config;
}
