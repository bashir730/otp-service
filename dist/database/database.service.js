"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
class DatabaseService {
    connected = false;
    db = null;
    dbPath;
    constructor(dbPath) {
        this.dbPath = dbPath;
    }
    /* ---------- INIT ---------- */
    init() {
        const resolved = path_1.default.resolve(process.cwd(), this.dbPath);
        fs_1.default.mkdirSync(path_1.default.dirname(resolved), { recursive: true });
        this.db = new better_sqlite3_1.default(resolved);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(this.readSqlFile('schema.sql'));
        this.runMigrations();
        this.connected = true;
        logger_1.logger.info({ dbPath: resolved }, 'Database connected (SQLite)');
    }
    readSqlFile(name) {
        const candidates = [
            path_1.default.resolve(__dirname, name),
            path_1.default.resolve(__dirname, 'database', name),
            path_1.default.resolve(process.cwd(), 'src', 'database', name)
        ];
        for (const c of candidates) {
            if (fs_1.default.existsSync(c))
                return fs_1.default.readFileSync(c, 'utf8');
        }
        throw new errors_1.AppError('INTERNAL_ERROR', 500, `SQL file not found: ${name}`);
    }
    runMigrations() {
        const db = this.require();
        db.exec(`CREATE TABLE IF NOT EXISTS migrations (
        version    TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`);
        const migrationsDir = (() => {
            const candidates = [
                path_1.default.resolve(__dirname, 'migrations'),
                path_1.default.resolve(process.cwd(), 'src', 'database', 'migrations')
            ];
            return candidates.find((c) => fs_1.default.existsSync(c)) || candidates[0];
        })();
        if (!fs_1.default.existsSync(migrationsDir))
            return;
        const files = fs_1.default
            .readdirSync(migrationsDir)
            .filter((f) => f.endsWith('.sql'))
            .sort();
        for (const file of files) {
            const version = file.replace(/\.sql$/, '');
            const applied = db
                .prepare('SELECT version FROM migrations WHERE version = ?')
                .get(version);
            if (applied)
                continue;
            const sql = fs_1.default.readFileSync(path_1.default.join(migrationsDir, file), 'utf8');
            db.exec(sql);
            db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
            logger_1.logger.info({ migration: version }, 'Migration applied');
        }
    }
    require() {
        if (!this.db)
            throw new errors_1.AppError('INTERNAL_ERROR', 500, 'Database not initialized');
        return this.db;
    }
    isConnected() {
        try {
            if (!this.db)
                return false;
            this.db.prepare('SELECT 1').get();
            return true;
        }
        catch {
            return false;
        }
    }
    close() {
        try {
            this.db?.close();
        }
        catch {
            /* noop */
        }
        this.db = null;
        this.connected = false;
    }
    /* ---------- API CLIENTS ---------- */
    createClient(name, apiKeyHash) {
        const db = this.require();
        const existing = db.prepare('SELECT id FROM api_clients WHERE name = ?').get(name);
        if (existing)
            throw new errors_1.AppError('CLIENT_EXISTS', 409);
        const info = db
            .prepare('INSERT INTO api_clients (name, api_key_hash) VALUES (?, ?)')
            .run(name, apiKeyHash);
        return this.getClientById(Number(info.lastInsertRowid));
    }
    getClientById(id) {
        const db = this.require();
        const row = db
            .prepare('SELECT * FROM api_clients WHERE id = ?')
            .get(id);
        if (!row)
            throw new errors_1.AppError('NOT_FOUND', 404, 'Client not found');
        return row;
    }
    findClientByHash(apiKeyHash) {
        const db = this.require();
        const row = db
            .prepare('SELECT * FROM api_clients WHERE api_key_hash = ?')
            .get(apiKeyHash);
        return row || null;
    }
    listClients() {
        const db = this.require();
        return db
            .prepare('SELECT id, name, active, created_at FROM api_clients ORDER BY id')
            .all();
    }
    setClientActive(id, active) {
        const db = this.require();
        const info = db.prepare('UPDATE api_clients SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
        if (info.changes === 0)
            throw new errors_1.AppError('NOT_FOUND', 404, 'Client not found');
    }
    /* ---------- OTP REQUESTS ---------- */
    createOtpRequest(clientId, phone, purpose, otpHash, expiresAt) {
        const db = this.require();
        const info = db
            .prepare(`INSERT INTO otp_requests (client_id, phone, purpose, otp_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`)
            .run(clientId, phone, purpose, otpHash, expiresAt);
        return Number(info.lastInsertRowid);
    }
    /** OTPهای قبلیِ فعالِ همان شماره/هدف را باطل می‌کند */
    invalidatePrevious(clientId, phone, purpose) {
        const db = this.require();
        db.prepare(`UPDATE otp_requests
       SET invalidated = 1
       WHERE client_id = ? AND phone = ? AND purpose = ? AND verified = 0 AND invalidated = 0`).run(clientId, phone, purpose);
    }
    findActiveOtp(clientId, phone, purpose) {
        const db = this.require();
        const row = db
            .prepare(`SELECT * FROM otp_requests
         WHERE client_id = ? AND phone = ? AND purpose = ? AND verified = 0 AND invalidated = 0
         ORDER BY id DESC LIMIT 1`)
            .get(clientId, phone, purpose);
        return row || null;
    }
    incrementAttempts(id) {
        const db = this.require();
        db.prepare('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = ?').run(id);
        const row = db.prepare('SELECT attempts FROM otp_requests WHERE id = ?').get(id);
        return row?.attempts ?? 0;
    }
    markVerified(id) {
        const db = this.require();
        db.prepare('UPDATE otp_requests SET verified = 1 WHERE id = ?').run(id);
    }
    markInvalidated(id) {
        const db = this.require();
        db.prepare('UPDATE otp_requests SET invalidated = 1 WHERE id = ?').run(id);
    }
    /** برای تست: انقضای فوری یک درخواست */
    forceExpire(id) {
        const db = this.require();
        db.prepare(`UPDATE otp_requests SET expires_at = datetime('now', '-1 second') WHERE id = ?`).run(id);
    }
    /* ---------- LOGS ---------- */
    log(clientId, phone, action, status, ip) {
        try {
            const db = this.require();
            db.prepare('INSERT INTO logs (client_id, phone, action, status, ip) VALUES (?, ?, ?, ?, ?)').run(clientId, phone, action, status, ip);
        }
        catch (err) {
            logger_1.logger.error({ err: err.message }, 'Failed to write log row');
        }
    }
}
exports.DatabaseService = DatabaseService;
