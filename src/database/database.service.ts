import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/* ==================================================
   SQLite — schema.sql + migrations
   ================================================== */

export interface ApiClientRow {
  id: number;
  name: string;
  api_key_hash: string;
  active: number;
  created_at: string;
}

export interface OtpRequestRow {
  id: number;
  client_id: number;
  phone: string;
  purpose: string;
  otp_hash: string;
  attempts: number;
  verified: number;
  invalidated: number;
  created_at: string;
  expires_at: string;
}

export class DatabaseService {
  public connected = false;
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /* ---------- INIT ---------- */
  init(): void {
    const resolved = path.resolve(process.cwd(), this.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });

    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(this.readSqlFile('schema.sql'));
    this.runMigrations();
    this.connected = true;
    logger.info({ dbPath: resolved }, 'Database connected (SQLite)');
  }

  private readSqlFile(name: string): string {
    const candidates = [
      path.resolve(__dirname, name),
      path.resolve(__dirname, 'database', name),
      path.resolve(process.cwd(), 'src', 'database', name)
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
    }
    throw new AppError('INTERNAL_ERROR', 500, `SQL file not found: ${name}`);
  }

  private runMigrations(): void {
    const db = this.require();
    db.exec(
      `CREATE TABLE IF NOT EXISTS migrations (
        version    TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`
    );

    const migrationsDir = (() => {
      const candidates = [
        path.resolve(__dirname, 'migrations'),
        path.resolve(process.cwd(), 'src', 'database', 'migrations')
      ];
      return candidates.find((c) => fs.existsSync(c)) || candidates[0];
    })();

    if (!fs.existsSync(migrationsDir)) return;

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const applied = db
        .prepare('SELECT version FROM migrations WHERE version = ?')
        .get(version);
      if (applied) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      db.exec(sql);
      db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
      logger.info({ migration: version }, 'Migration applied');
    }
  }

  private require(): Database.Database {
    if (!this.db) throw new AppError('INTERNAL_ERROR', 500, 'Database not initialized');
    return this.db;
  }

  isConnected(): boolean {
    try {
      if (!this.db) return false;
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* noop */
    }
    this.db = null;
    this.connected = false;
  }

  /* ---------- API CLIENTS ---------- */
  createClient(name: string, apiKeyHash: string): ApiClientRow {
    const db = this.require();
    const existing = db.prepare('SELECT id FROM api_clients WHERE name = ?').get(name);
    if (existing) throw new AppError('CLIENT_EXISTS', 409);
    const info = db
      .prepare('INSERT INTO api_clients (name, api_key_hash) VALUES (?, ?)')
      .run(name, apiKeyHash);
    return this.getClientById(Number(info.lastInsertRowid));
  }

  getClientById(id: number): ApiClientRow {
    const db = this.require();
    const row = db
      .prepare('SELECT * FROM api_clients WHERE id = ?')
      .get(id) as ApiClientRow | undefined;
    if (!row) throw new AppError('NOT_FOUND', 404, 'Client not found');
    return row;
  }

  findClientByHash(apiKeyHash: string): ApiClientRow | null {
    const db = this.require();
    const row = db
      .prepare('SELECT * FROM api_clients WHERE api_key_hash = ?')
      .get(apiKeyHash) as ApiClientRow | undefined;
    return row || null;
  }

  listClients(): Array<Omit<ApiClientRow, 'api_key_hash'>> {
    const db = this.require();
    return db
      .prepare('SELECT id, name, active, created_at FROM api_clients ORDER BY id')
      .all() as Array<Omit<ApiClientRow, 'api_key_hash'>>;
  }

  setClientActive(id: number, active: boolean): void {
    const db = this.require();
    const info = db.prepare('UPDATE api_clients SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (info.changes === 0) throw new AppError('NOT_FOUND', 404, 'Client not found');
  }

  /* ---------- OTP REQUESTS ---------- */
  createOtpRequest(
    clientId: number,
    phone: string,
    purpose: string,
    otpHash: string,
    expiresAt: string
  ): number {
    const db = this.require();
    const info = db
      .prepare(
        `INSERT INTO otp_requests (client_id, phone, purpose, otp_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(clientId, phone, purpose, otpHash, expiresAt);
    return Number(info.lastInsertRowid);
  }

  /** OTPهای قبلیِ فعالِ همان شماره/هدف را باطل می‌کند */
  invalidatePrevious(clientId: number, phone: string, purpose: string): void {
    const db = this.require();
    db.prepare(
      `UPDATE otp_requests
       SET invalidated = 1
       WHERE client_id = ? AND phone = ? AND purpose = ? AND verified = 0 AND invalidated = 0`
    ).run(clientId, phone, purpose);
  }

  findActiveOtp(clientId: number, phone: string, purpose: string): OtpRequestRow | null {
    const db = this.require();
    const row = db
      .prepare(
        `SELECT * FROM otp_requests
         WHERE client_id = ? AND phone = ? AND purpose = ? AND verified = 0 AND invalidated = 0
         ORDER BY id DESC LIMIT 1`
      )
      .get(clientId, phone, purpose) as OtpRequestRow | undefined;
    return row || null;
  }

  incrementAttempts(id: number): number {
    const db = this.require();
    db.prepare('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = ?').run(id);
    const row = db.prepare('SELECT attempts FROM otp_requests WHERE id = ?').get(id) as
      | { attempts: number }
      | undefined;
    return row?.attempts ?? 0;
  }

  markVerified(id: number): void {
    const db = this.require();
    db.prepare('UPDATE otp_requests SET verified = 1 WHERE id = ?').run(id);
  }

  markInvalidated(id: number): void {
    const db = this.require();
    db.prepare('UPDATE otp_requests SET invalidated = 1 WHERE id = ?').run(id);
  }

  /** برای تست: انقضای فوری یک درخواست */
  forceExpire(id: number): void {
    const db = this.require();
    db.prepare(`UPDATE otp_requests SET expires_at = datetime('now', '-1 second') WHERE id = ?`).run(id);
  }

  /* ---------- LOGS ---------- */
  log(
    clientId: number | null,
    phone: string | null,
    action: string,
    status: string,
    ip: string | null
  ): void {
    try {
      const db = this.require();
      db.prepare(
        'INSERT INTO logs (client_id, phone, action, status, ip) VALUES (?, ?, ?, ?, ?)'
      ).run(clientId, phone, action, status, ip);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Failed to write log row');
    }
  }
}
