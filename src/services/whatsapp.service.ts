import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { silentLogger } from '../utils/logger';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

/* ==================================================
   WhatsAppService — لایه مستقل اتصال به Baileys
   OTPService هرگز مستقیم با Baileys کار نمی‌کند؛
   برای تعویض provider کافی است همین کلاس عوض شود.

   - QR در terminal
   - session در auth/baileys-session (باید در .gitignore باشد)
   - reconnect خودکار + backoff
   - session خراب (loggedOut) به‌صورت کنترل‌شده پاک و QR جدید صادر می‌شود
   - هیچ خطایی به بیرون throw نمی‌شود؛ برنامه crash نمی‌کند
   ================================================== */

export type WhatsAppState = 'disconnected' | 'connecting' | 'connected' | 'logged_out';

export class WhatsAppService {
  public state: WhatsAppState = 'disconnected';
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private connecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly sessionDir: string;
  private lastQr: string | null = null;
  private connectedCb: (() => void) | null = null;

  constructor(sessionDir: string) {
    this.sessionDir = path.resolve(process.cwd(), sessionDir);
  }

  isConnected(): boolean {
    return this.state === 'connected' && this.sock !== null;
  }

  /* ورود با session: creds.json آماده را می‌پذیرد و بدون QR وصل می‌شود */
  async importSession(creds: unknown): Promise<{ user: string }> {
    const c = creds as { me?: { id?: string }; noiseKey?: unknown };
    if (!c || typeof c !== 'object' || !c.me?.id || !c.noiseKey) {
      throw new AppError('INVALID_SESSION', 400, 'Session data is invalid — expected a Baileys creds.json (JSON or base64)');
    }
    fs.mkdirSync(this.sessionDir, { recursive: true });
    await this.end();
    fs.writeFileSync(path.join(this.sessionDir, 'creds.json'), JSON.stringify(c, null, 2));
    logger.info({ user: String(c.me.id).split('@')[0] }, 'Session imported — connecting without QR');
    void this.connect();
    return { user: String(c.me.id).split('@')[0] };
  }

  /* callback بعد از اتصال موفق (پشتیبان‌گیری session) */
  onConnected(cb: () => void): void {
    this.connectedCb = cb;
  }

  /* آخرین QR برای صفحه اسکن ادمین (Render/بدون terminal) */
  getLastQr(): string | null {
    return this.lastQr;
  }

  getState(): WhatsAppState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.connecting || this.isConnected()) return;
    this.connecting = true;
    this.state = 'connecting';

    try {
      fs.mkdirSync(this.sessionDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      let version: [number, number, number] | undefined;
      try {
        const fetched = await fetchLatestWaWebVersion({});
        version = fetched.version;
      } catch {
        logger.warn('Could not fetch latest WhatsApp Web version — using default');
      }

      const sock = makeWASocket({
        version,
        logger: silentLogger,
        printQRInTerminal: false,
        auth: state,
        browser: ['otp-service', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false
      });

      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.state = 'connecting';
          this.lastQr = qr;
          logger.info('WhatsApp authentication required — scan QR code in terminal');
          /* نمایش QR در terminal */
          qrcode.generate(qr, { small: true });
          console.info('\n📱 Scan this QR code with WhatsApp → Settings → Linked Devices → Link a Device\n');
        }

        if (connection === 'open') {
          this.connecting = false;
          this.lastQr = null;
          this.reconnectAttempts = 0;
          this.state = 'connected';
          logger.info({ user: sock.user?.id ? String(sock.user.id).split('@')[0] : 'unknown' }, 'WhatsApp connected');
          if (this.connectedCb) {
            try { this.connectedCb(); } catch { /* ignore */ }
          }
        }

        if (connection === 'close') {
          const boom = lastDisconnect?.error ? new Boom(lastDisconnect.error) : null;
          const code = boom?.output?.statusCode;
          this.sock = null;
          this.connecting = false;

          if (code === DisconnectReason.loggedOut) {
            /* session خراب/حذف‌شده — پاکسازی کنترل‌شده و QR جدید */
            this.state = 'logged_out';
            logger.warn('WhatsApp session logged out — session cleared, new QR will be issued');
            try {
              if (fs.existsSync(this.sessionDir)) {
                fs.rmSync(this.sessionDir, { recursive: true, force: true });
              }
            } catch (err) {
              logger.error({ err: (err as Error).message }, 'Failed to clear session directory');
            }
            this.scheduleReconnect(3000);
            return;
          }

          this.state = 'disconnected';
          const reason = typeof code === 'number' ? DisconnectReason[code] : 'unknown';
          logger.warn({ code, reason }, 'WhatsApp disconnected');
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      this.connecting = false;
      this.state = 'disconnected';
      logger.error({ err: (err as Error).message }, 'WhatsApp connect failed');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const backoff = delayMs ?? Math.min(this.reconnectAttempts * 2000, 30_000);
    logger.info({ attempt: this.reconnectAttempts, inMs: backoff }, 'WhatsApp reconnect scheduled');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, backoff);
  }

  /** ارسال پیام متنی به شماره E.164 */
  async sendMessage(phone: string, message: string): Promise<void> {
    if (!this.isConnected() || !this.sock) {
      throw new AppError('WHATSAPP_NOT_READY', 503);
    }
    const jid = `${phone}@s.whatsapp.net`;
    try {
      await this.sock.sendMessage(jid, { text: message });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'WhatsApp send failed');
      throw new AppError('OTP_SEND_FAILED', 502);
    }
  }

  /** خروج کامل و حذف session */
  async logout(): Promise<void> {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'WhatsApp logout error (continuing)');
    }
    this.sock = null;
    this.state = 'disconnected';
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Failed to remove session directory');
    }
    logger.info('WhatsApp logged out and session removed');
  }

  /** خاموشی نرم — بدون حذف session */
  async end(): Promise<void> {
    try {
      if (this.sock) await this.sock.end(undefined);
    } catch {
      /* noop */
    }
    this.sock = null;
    this.state = 'disconnected';
  }
}
