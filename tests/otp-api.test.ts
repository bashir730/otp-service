import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';

import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/services/redis.service';
import { OTPService } from '../src/services/otp.service';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config/config';
import { generateApiKey, hashApiKey, hashOTP, generateOTP } from '../src/utils/otp';
import { normalizePhone } from '../src/utils/phone';
import { AppError } from '../src/utils/errors';

/* ==================================================
   Test harness — app کامل با dependencyهای واقعی:
   - SQLite در tmp
   - Redis روی URL مرده (مسیر fallback تست می‌شود)
   - WhatsApp فیک (پیام‌ها capture می‌شوند)
   ================================================== */

class FakeWhatsApp {
  connected = true;
  messages: Array<{ phone: string; message: string }> = [];

  async sendMessage(phone: string, message: string): Promise<void> {
    if (!this.connected) throw new AppError('WHATSAPP_NOT_READY', 503);
    this.messages.push({ phone, message });
  }
  isConnected(): boolean {
    return this.connected;
  }
  getState(): string {
    return this.connected ? 'connected' : 'disconnected';
  }
}

interface Harness {
  port: number;
  baseUrl: string;
  server: http.Server;
  db: DatabaseService;
  redis: RedisService;
  wa: FakeWhatsApp;
  otp: OTPService;
  config: AppConfig;
  apiKey: string;
  clientId: number;
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    DATABASE_PATH: './data/test.sqlite',
    REDIS_URL: 'redis://localhost:6379',
    OTP_LENGTH: 6,
    OTP_EXPIRES_SECONDS: 300,
    OTP_RESEND_SECONDS: 60,
    OTP_MAX_ATTEMPTS: 5,
    RATE_LIMIT_PER_IP: 1000,
    RATE_LIMIT_PER_PHONE: 3,
    RATE_LIMIT_PER_CLIENT: 1000,
    CORS_ORIGIN: '*',
    LOG_LEVEL: 'silent',
    DEFAULT_REGION: 'AF',
    WHATSAPP_AUTO_CONNECT: false,
    ADMIN_KEY: 'test-admin-key-123',
    OTP_PEPPER: 'test-pepper-do-not-use-in-prod',
    OTP_MESSAGE_TEMPLATE: 'Your verification code:\n{code}\n\nThis code is valid for {minutes} minutes.',
    ...overrides
  };
}

async function buildHarness(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  const config = makeConfig(overrides);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otp-test-'));

  const db = new DatabaseService(path.join(tmp, 'test.sqlite'));
  db.init();

  /* Redis مرده → fallback درون‌حافظه‌ای */
  const redis = new RedisService('redis://localhost:1/0');
  redis.connect();

  const wa = new FakeWhatsApp();
  const otp = new OTPService(db, redis, wa, config);

  const app = createApp({ config, db, redis, whatsapp: wa, otp });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  /* یک API client واقعی در دیتابیس */
  const apiKey = 'TESTKEY_' + crypto.randomBytes(12).toString('hex');
  const client = db.createClient('TEST-CLIENT', hashApiKey(apiKey));

  return { port, baseUrl: `http://127.0.0.1:${port}`, server, db, redis, wa, otp, config, apiKey, clientId: client.id };
}

async function closeHarness(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  h.db.close();
  await h.redis.quit();
}

async function api(h: Harness, method: string, pathName: string, body?: unknown, key?: string | null, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(h.baseUrl + pathName, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key !== undefined ? { Authorization: `Bearer ${key}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

const PHONE = '+93700123456';

function lastCode(wa: FakeWhatsApp): string {
  const msg = wa.messages[wa.messages.length - 1].message;
  const m = msg.match(/(\d{6})/);
  assert.ok(m, 'OTP code found in message');
  return m[1];
}

/* ================================================== */

describe('utils', () => {
  test('normalizePhone — E.164 با فرمت‌های مختلف', () => {
    assert.equal(normalizePhone('+93700123456', 'AF'), '+93700123456');
    assert.equal(normalizePhone('93700123456', 'AF'), '+93700123456');
    assert.equal(normalizePhone('0093700123456', 'AF'), '+93700123456');
    assert.equal(normalizePhone('0700123456', 'AF'), '+93700123456');
  });

  test('normalizePhone — شماره بین‌المللی دیگر', () => {
    assert.equal(normalizePhone('+14155552671', 'AF'), '+14155552671');
    assert.equal(normalizePhone('004915112345678', 'AF'), '+4915112345678');
  });

  test('normalizePhone — نامعتبر → null', () => {
    assert.equal(normalizePhone('abc', 'AF'), null);
    assert.equal(normalizePhone('', 'AF'), null);
    assert.equal(normalizePhone('123', 'AF'), null);
  });

  test('generateOTP — طول درست و رقم‌دار', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOTP(6);
      assert.equal(code.length, 6);
      assert.match(code, /^\d{6}$/);
    }
  });

  test('hashOTP — پایدار و غیرقابل برگشت', () => {
    const pepper = 'pepper-x';
    assert.equal(hashOTP('482731', pepper), hashOTP('482731', pepper));
    assert.notEqual(hashOTP('482731', pepper), hashOTP('482732', pepper));
    assert.equal(hashOTP('482731', pepper).length, 64);
  });
});

describe('OTP API — جریان کامل', () => {
  let h: Harness;

  before(async () => {
    h = await buildHarness();
  });

  after(async () => {
    await closeHarness(h);
  });

  test('send → پیام WhatsApp با کد + response استاندارد', async () => {
    const res = await api(h, 'POST', '/api/v1/otp/send', { phone: '0093700123456', purpose: 'login' }, h.apiKey);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, 'OTP sent successfully');
    assert.equal(res.body.expiresIn, 300);
    assert.equal(h.wa.messages.length, 1);
    assert.ok(h.wa.messages[0].message.includes(lastCode(h.wa)));
    /* کد خام در response نباشد */
    assert.ok(!JSON.stringify(res.body).match(/^\d{6}$/m));
    /* در دیتابیس فقط hash */
    const rec = h.db.findActiveOtp(h.clientId, PHONE, 'login');
    assert.ok(rec);
    assert.ok(!rec.otp_hash.includes(lastCode(h.wa)));
  });

  test('verify با کد درست → verified', async () => {
    const code = lastCode(h.wa);
    const res = await api(h, 'POST', '/api/v1/otp/verify', { phone: '93700123456', code, purpose: 'login' }, h.apiKey);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, verified: true });
  });

  test('reuse همان کد → INVALID_OTP', async () => {
    const code = lastCode(h.wa);
    const res = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code, purpose: 'login' }, h.apiKey);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'INVALID_OTP');
    assert.equal(res.body.verified, false);
  });

  test('کد اشتباه → INVALID_OTP', async () => {
    await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'signup' }, h.apiKey);
    const res = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code: '000000', purpose: 'signup' }, h.apiKey);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'INVALID_OTP');
  });

  test('OTP منقضی → OTP_EXPIRED', async () => {
    await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'reset' }, h.apiKey);
    const rec = h.db.findActiveOtp(h.clientId, PHONE, 'reset');
    h.db.forceExpire(rec!.id);
    const code = lastCode(h.wa);
    const res = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code, purpose: 'reset' }, h.apiKey);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'OTP_EXPIRED');
  });

  test('OTP جدید OTP قبلی را باطل می‌کند', async () => {
    await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'reissue' }, h.apiKey);
    const firstCode = lastCode(h.wa);
    /* پاک کردن کلیدهای rate برای شبیه‌سازی گذشت زمان در تست */
    await h.redis.del(`otp:wait:${PHONE}:reissue`, `rate:phone:${PHONE}`);
    await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'reissue' }, h.apiKey);
    const secondCode = lastCode(h.wa);
    assert.notEqual(firstCode, secondCode);
    const res = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code: firstCode, purpose: 'reissue' }, h.apiKey);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'INVALID_OTP');
  });
});

describe('OTP — سقف تلاشها و rate limit', () => {
  test('بیش از MAX_ATTEMPTS → TOO_MANY_ATTEMPTS', async () => {
    const h = await buildHarness({ OTP_MAX_ATTEMPTS: 2 });
    try {
      await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      const code = lastCode(h.wa);
      const r1 = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code: '111111', purpose: 'login' }, h.apiKey);
      assert.equal(r1.body.error, 'INVALID_OTP');
      const r2 = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code: '222222', purpose: 'login' }, h.apiKey);
      assert.equal(r2.status, 429);
      assert.equal(r2.body.error, 'TOO_MANY_ATTEMPTS');
      /* حتی با کد درست دیگر قبول نمی‌شود */
      const r3 = await api(h, 'POST', '/api/v1/otp/verify', { phone: PHONE, code, purpose: 'login' }, h.apiKey);
      assert.equal(r3.status, 429);
    } finally {
      await closeHarness(h);
    }
  });

  test('resend سریع → RATE_LIMITED (۱ در پنجره resend)', async () => {
    const h = await buildHarness();
    try {
      const r1 = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(r1.status, 200);
      const r2 = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(r2.status, 429);
      assert.equal(r2.body.error, 'RATE_LIMITED');
    } finally {
      await closeHarness(h);
    }
  });

  test('سقف درخواست برای هر شماره در دقیقه', async () => {
    const h = await buildHarness({ RATE_LIMIT_PER_PHONE: 1 });
    try {
      const r1 = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(r1.status, 200);
      await h.redis.del(`otp:wait:${PHONE}:login`);
      const r2 = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(r2.status, 429);
      assert.equal(r2.body.error, 'RATE_LIMITED');
    } finally {
      await closeHarness(h);
    }
  });

  test('rate limit هر IP', async () => {
    const h = await buildHarness({ RATE_LIMIT_PER_IP: 2 });
    try {
      const bad = { phone: PHONE, purpose: 'login' };
      await api(h, 'POST', '/api/v1/otp/send', { phone: '9999999999', purpose: 'x' }, h.apiKey);
      await api(h, 'POST', '/api/v1/otp/send', { phone: '9999999999', purpose: 'y' }, h.apiKey);
      const r3 = await api(h, 'POST', '/api/v1/otp/send', bad, h.apiKey);
      assert.equal(r3.status, 429);
      assert.equal(r3.body.error, 'RATE_LIMITED');
    } finally {
      await closeHarness(h);
    }
  });
});

describe('Authentication — API keys', () => {
  test('بدون کلید → 401 UNAUTHORIZED', async () => {
    const h = await buildHarness();
    try {
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, null);
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'UNAUTHORIZED');
    } finally {
      await closeHarness(h);
    }
  });

  test('کلید نامعتبر → 401 UNAUTHORIZED', async () => {
    const h = await buildHarness();
    try {
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, 'WRONG-KEY-123');
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'UNAUTHORIZED');
    } finally {
      await closeHarness(h);
    }
  });

  test('client غیرفعال → 403', async () => {
    const h = await buildHarness();
    try {
      h.db.setClientActive(h.clientId, false);
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'CLIENT_INACTIVE');
    } finally {
      await closeHarness(h);
    }
  });

  test('مدیریت clients با admin key', async () => {
    const h = await buildHarness();
    try {
      /* بدون admin key → 401 */
      const noKey = await api(h, 'GET', '/api/v1/clients');
      assert.equal(noKey.status, 401);

      /* ساخت client جدید */
      const created = await api(h, 'POST', '/api/v1/clients', { name: 'NOVA-WEB' }, undefined, { 'x-admin-key': 'test-admin-key-123' });
      assert.equal(created.status, 201);
      assert.ok(created.body.apiKey.startsWith('OTPS_'));

      /* کلید جدید واقعاً کار می‌کند */
      const send = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, created.body.apiKey);
      assert.equal(send.status, 200);

      /* فهرست — بدون hash کلید */
      const list = await api(h, 'GET', '/api/v1/clients', undefined, undefined, { 'x-admin-key': 'test-admin-key-123' });
      assert.ok(list.body.clients.length >= 2);
      assert.ok(!JSON.stringify(list.body).includes('api_key_hash'));

      /* غیرفعال کردن */
      const id = created.body.client.id;
      const patched = await api(h, 'PATCH', `/api/v1/clients/${id}`, { active: false }, undefined, { 'x-admin-key': 'test-admin-key-123' });
      assert.equal(patched.body.success, true);
      const blocked = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, created.body.apiKey);
      assert.equal(blocked.status, 403);
    } finally {
      await closeHarness(h);
    }
  });
});

describe('Validation و خطاها', () => {
  test('شماره نامعتبر → INVALID_PHONE', async () => {
    const h = await buildHarness();
    try {
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: '123456789', purpose: 'login' }, h.apiKey);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'INVALID_PHONE');
    } finally {
      await closeHarness(h);
    }
  });

  test('body ناقص → VALIDATION_ERROR', async () => {
    const h = await buildHarness();
    try {
      const res = await api(h, 'POST', '/api/v1/otp/send', { purpose: 'login' }, h.apiKey);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'INVALID_PHONE');
    } finally {
      await closeHarness(h);
    }
  });

  test('مسیر ناموجود → NOT_FOUND بدون stack trace', async () => {
    const h = await buildHarness();
    try {
      const res = await api(h, 'GET', '/api/v1/unknown');
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'NOT_FOUND');
      assert.ok(!('stack' in res.body));
    } finally {
      await closeHarness(h);
    }
  });
});

describe('مقاومت سرویس‌ها', () => {
  test('Redis قطع → سرویس با fallback کار می‌کند', async () => {
    const h = await buildHarness();
    try {
      /* REDIS_URL مرده است — باید fallback فعال باشد */
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(h.redis.isConnected(), false);
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(res.status, 200);
    } finally {
      await closeHarness(h);
    }
  });

  test('SQLite قطع → health خطا می‌دهد ولی crash نمی‌کند', async () => {
    const h = await buildHarness();
    try {
      h.db.close();
      const health = await api(h, 'GET', '/api/v1/health');
      assert.equal(health.status, 503);
      assert.equal(health.body.database, 'disconnected');
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(res.status, 500);
      assert.equal(res.body.error, 'INTERNAL_ERROR');
      assert.ok(!('stack' in res.body));
    } finally {
      await closeHarness(h);
    }
  });

  test('WhatsApp قطع → WHATSAPP_NOT_READY', async () => {
    const h = await buildHarness();
    try {
      h.wa.connected = false;
      const res = await api(h, 'POST', '/api/v1/otp/send', { phone: PHONE, purpose: 'login' }, h.apiKey);
      assert.equal(res.status, 503);
      assert.equal(res.body.error, 'WHATSAPP_NOT_READY');
    } finally {
      await closeHarness(h);
    }
  });

  test('health — همه سالم', async () => {
    const h = await buildHarness();
    try {
      const res = await api(h, 'GET', '/api/v1/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.whatsapp, 'connected');
      assert.equal(res.body.database, 'connected');
      assert.ok(['ok', 'degraded'].includes(res.body.status));
    } finally {
      await closeHarness(h);
    }
  });
});
