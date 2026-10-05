"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
class RedisService {
    connected = false;
    client = null;
    url;
    memory = new Map();
    constructor(url) {
        this.url = url;
    }
    connect() {
        try {
            this.client = new ioredis_1.default(this.url, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
                retryStrategy: (times) => Math.min(times * 500, 5000)
            });
            this.client.on('connect', () => {
                this.connected = true;
                logger_1.logger.info({ url: this.maskUrl() }, 'Redis connected');
            });
            this.client.on('ready', () => {
                this.connected = true;
            });
            this.client.on('error', (err) => {
                if (this.connected) {
                    logger_1.logger.warn({ err: err.message }, 'Redis connection error — using in-memory fallback');
                }
                this.connected = false;
            });
            this.client.on('end', () => {
                this.connected = false;
            });
            this.client.connect().catch(() => {
                /* اولین اتصال ناموفق — fallback فعال است؛ retry در پس‌زمینه */
                logger_1.logger.warn('Redis unavailable at startup — using in-memory fallback');
            });
        }
        catch (err) {
            logger_1.logger.warn({ err: err.message }, 'Redis init failed — in-memory fallback');
            this.client = null;
        }
    }
    maskUrl() {
        try {
            const u = new URL(this.url);
            return `${u.protocol}//${u.hostname}:${u.port || '6379'}`;
        }
        catch {
            return 'invalid-url';
        }
    }
    isConnected() {
        return this.connected;
    }
    /* ---------- fallback memory ---------- */
    memGet(key) {
        const entry = this.memory.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.memory.delete(key);
            return null;
        }
        return entry.value;
    }
    memSet(key, value, ttlSeconds) {
        if (this.memory.size > 50_000) {
            /* جلوگیری از رشد بی‌حد fallback */
            const now = Date.now();
            for (const [k, v] of this.memory) {
                if (now > v.expiresAt)
                    this.memory.delete(k);
            }
        }
        this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
    /* ---------- operations (با fallback) ---------- */
    /** incr با TTL — برای fixed-window rate limit */
    async incrWithTtl(key, ttlSeconds) {
        if (this.connected && this.client) {
            try {
                const count = await this.client.incr(key);
                if (count === 1)
                    await this.client.expire(key, ttlSeconds);
                return count;
            }
            catch {
                this.connected = false;
            }
        }
        const entry = this.memory.get(key);
        const alive = entry !== undefined && Date.now() <= entry.expiresAt;
        const next = (alive ? parseInt(entry.value, 10) : 0) + 1;
        if (alive) {
            entry.value = String(next); /* TTL اولین incr حفظ می‌شود — پنجره fixed */
        }
        else {
            this.memSet(key, String(next), ttlSeconds);
        }
        return next;
    }
    async ttl(key) {
        if (this.connected && this.client) {
            try {
                return await this.client.ttl(key);
            }
            catch {
                this.connected = false;
            }
        }
        const entry = this.memory.get(key);
        if (!entry)
            return -2;
        const left = Math.ceil((entry.expiresAt - Date.now()) / 1000);
        return left > 0 ? left : -2;
    }
    async set(key, value, ttlSeconds) {
        if (this.connected && this.client) {
            try {
                await this.client.set(key, value, 'EX', ttlSeconds);
                return;
            }
            catch {
                this.connected = false;
            }
        }
        this.memSet(key, value, ttlSeconds);
    }
    async get(key) {
        if (this.connected && this.client) {
            try {
                return await this.client.get(key);
            }
            catch {
                this.connected = false;
            }
        }
        return this.memGet(key);
    }
    async del(...keys) {
        if (keys.length === 0)
            return;
        if (this.connected && this.client) {
            try {
                await this.client.del(...keys);
            }
            catch {
                this.connected = false;
            }
        }
        for (const k of keys)
            this.memory.delete(k);
    }
    async ping() {
        if (!this.client)
            return false;
        try {
            const res = await this.client.ping();
            this.connected = res === 'PONG';
            return this.connected;
        }
        catch {
            this.connected = false;
            return false;
        }
    }
    async quit() {
        try {
            if (this.client) {
                this.client.disconnect();
            }
        }
        catch {
            /* noop */
        }
        this.connected = false;
    }
}
exports.RedisService = RedisService;
