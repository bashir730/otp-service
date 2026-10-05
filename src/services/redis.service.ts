import Redis from 'ioredis';
import { logger } from '../utils/logger';

/* ==================================================
   Redis — داده‌های موقت و rate limiting
   اگر Redis در دسترس نباشد، سرویس با fallback
   درون‌حافظه‌ای به کار خود ادامه می‌دهد (crash نمی‌کند)
   ================================================== */

interface MemEntry {
  value: string;
  expiresAt: number; // ms epoch
}

export class RedisService {
  public connected = false;
  private client: Redis | null = null;
  private readonly url: string;
  private memory = new Map<string, MemEntry>();

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    try {
      this.client = new Redis(this.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times: number) => Math.min(times * 500, 5000)
      });

      this.client.on('connect', () => {
        this.connected = true;
        logger.info({ url: this.maskUrl() }, 'Redis connected');
      });
      this.client.on('ready', () => {
        this.connected = true;
      });
      this.client.on('error', (err: Error) => {
        if (this.connected) {
          logger.warn({ err: err.message }, 'Redis connection error — using in-memory fallback');
        }
        this.connected = false;
      });
      this.client.on('end', () => {
        this.connected = false;
      });

      this.client.connect().catch(() => {
        /* اولین اتصال ناموفق — fallback فعال است؛ retry در پس‌زمینه */
        logger.warn('Redis unavailable at startup — using in-memory fallback');
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Redis init failed — in-memory fallback');
      this.client = null;
    }
  }

  private maskUrl(): string {
    try {
      const u = new URL(this.url);
      return `${u.protocol}//${u.hostname}:${u.port || '6379'}`;
    } catch {
      return 'invalid-url';
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /* ---------- fallback memory ---------- */
  private memGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memSet(key: string, value: string, ttlSeconds: number): void {
    if (this.memory.size > 50_000) {
      /* جلوگیری از رشد بی‌حد fallback */
      const now = Date.now();
      for (const [k, v] of this.memory) {
        if (now > v.expiresAt) this.memory.delete(k);
      }
    }
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /* ---------- operations (با fallback) ---------- */

  /** incr با TTL — برای fixed-window rate limit */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (this.connected && this.client) {
      try {
        const count = await this.client.incr(key);
        if (count === 1) await this.client.expire(key, ttlSeconds);
        return count;
      } catch {
        this.connected = false;
      }
    }
    const entry = this.memory.get(key);
    const alive = entry !== undefined && Date.now() <= entry.expiresAt;
    const next = (alive ? parseInt(entry.value, 10) : 0) + 1;
    if (alive) {
      entry.value = String(next); /* TTL اولین incr حفظ می‌شود — پنجره fixed */
    } else {
      this.memSet(key, String(next), ttlSeconds);
    }
    return next;
  }

  async ttl(key: string): Promise<number> {
    if (this.connected && this.client) {
      try {
        return await this.client.ttl(key);
      } catch {
        this.connected = false;
      }
    }
    const entry = this.memory.get(key);
    if (!entry) return -2;
    const left = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return left > 0 ? left : -2;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.connected && this.client) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        this.connected = false;
      }
    }
    this.memSet(key, value, ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        this.connected = false;
      }
    }
    return this.memGet(key);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.connected && this.client) {
      try {
        await this.client.del(...keys);
      } catch {
        this.connected = false;
      }
    }
    for (const k of keys) this.memory.delete(k);
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const res = await this.client.ping();
      this.connected = res === 'PONG';
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async quit(): Promise<void> {
    try {
      if (this.client) {
        this.client.disconnect();
      }
    } catch {
      /* noop */
    }
    this.connected = false;
  }
}
