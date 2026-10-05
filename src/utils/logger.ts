import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

const options: pino.LoggerOptions = {
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    /* محافظت مضاعف: هرگز کد OTP و کلیدها وارد log نشوند */
    paths: ['req.headers.authorization', 'headers.authorization', '*.apiKey', '*.api_key', '*.otp', '*.code'],
    censor: '[REDACTED]'
  },
  base: { service: 'otp-service' }
};

if (process.env.NODE_ENV !== 'production') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' }
  };
}

export const logger = pino(options);

/* logger خام بدون pino-pretty برای سرویس‌های داخلی (Baileys) */
export const silentLogger = pino({ level: 'silent' });
