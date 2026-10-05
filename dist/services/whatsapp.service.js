"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const boom_1 = require("@hapi/boom");
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
const logger_2 = require("../utils/logger");
const errors_1 = require("../utils/errors");
class WhatsAppService {
    state = 'disconnected';
    sock = null;
    connecting = false;
    reconnectTimer = null;
    reconnectAttempts = 0;
    sessionDir;
    lastQr = null;
    connectedCb = null;
    constructor(sessionDir) {
        this.sessionDir = path_1.default.resolve(process.cwd(), sessionDir);
    }
    isConnected() {
        return this.state === 'connected' && this.sock !== null;
    }
    /* ورود با session: creds.json آماده را می‌پذیرد و بدون QR وصل می‌شود */
    async importSession(creds) {
        const c = creds;
        if (!c || typeof c !== 'object' || !c.me?.id || !c.noiseKey) {
            throw new errors_1.AppError('INVALID_SESSION', 400, 'Session data is invalid — expected a Baileys creds.json (JSON or base64)');
        }
        fs_1.default.mkdirSync(this.sessionDir, { recursive: true });
        await this.end();
        fs_1.default.writeFileSync(path_1.default.join(this.sessionDir, 'creds.json'), JSON.stringify(c, null, 2));
        logger_2.logger.info({ user: String(c.me.id).split('@')[0] }, 'Session imported — connecting without QR');
        void this.connect();
        return { user: String(c.me.id).split('@')[0] };
    }
    /* callback بعد از اتصال موفق (پشتیبان‌گیری session) */
    onConnected(cb) {
        this.connectedCb = cb;
    }
    /* آخرین QR برای صفحه اسکن ادمین (Render/بدون terminal) */
    getLastQr() {
        return this.lastQr;
    }
    getState() {
        return this.state;
    }
    async connect() {
        if (this.connecting || this.isConnected())
            return;
        this.connecting = true;
        this.state = 'connecting';
        try {
            fs_1.default.mkdirSync(this.sessionDir, { recursive: true });
            const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(this.sessionDir);
            let version;
            try {
                const fetched = await (0, baileys_1.fetchLatestWaWebVersion)({});
                version = fetched.version;
            }
            catch {
                logger_2.logger.warn('Could not fetch latest WhatsApp Web version — using default');
            }
            const sock = (0, baileys_1.default)({
                version,
                logger: logger_1.silentLogger,
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
                    logger_2.logger.info('WhatsApp authentication required — scan QR code in terminal');
                    /* نمایش QR در terminal */
                    qrcode_terminal_1.default.generate(qr, { small: true });
                    console.info('\n📱 Scan this QR code with WhatsApp → Settings → Linked Devices → Link a Device\n');
                }
                if (connection === 'open') {
                    this.connecting = false;
                    this.lastQr = null;
                    this.reconnectAttempts = 0;
                    this.state = 'connected';
                    logger_2.logger.info({ user: sock.user?.id ? String(sock.user.id).split('@')[0] : 'unknown' }, 'WhatsApp connected');
                    if (this.connectedCb) {
                        try {
                            this.connectedCb();
                        }
                        catch { /* ignore */ }
                    }
                }
                if (connection === 'close') {
                    const boom = lastDisconnect?.error ? new boom_1.Boom(lastDisconnect.error) : null;
                    const code = boom?.output?.statusCode;
                    this.sock = null;
                    this.connecting = false;
                    if (code === baileys_1.DisconnectReason.loggedOut) {
                        /* session خراب/حذف‌شده — پاکسازی کنترل‌شده و QR جدید */
                        this.state = 'logged_out';
                        logger_2.logger.warn('WhatsApp session logged out — session cleared, new QR will be issued');
                        try {
                            if (fs_1.default.existsSync(this.sessionDir)) {
                                fs_1.default.rmSync(this.sessionDir, { recursive: true, force: true });
                            }
                        }
                        catch (err) {
                            logger_2.logger.error({ err: err.message }, 'Failed to clear session directory');
                        }
                        this.scheduleReconnect(3000);
                        return;
                    }
                    this.state = 'disconnected';
                    const reason = typeof code === 'number' ? baileys_1.DisconnectReason[code] : 'unknown';
                    logger_2.logger.warn({ code, reason }, 'WhatsApp disconnected');
                    this.scheduleReconnect();
                }
            });
        }
        catch (err) {
            this.connecting = false;
            this.state = 'disconnected';
            logger_2.logger.error({ err: err.message }, 'WhatsApp connect failed');
            this.scheduleReconnect();
        }
    }
    scheduleReconnect(delayMs) {
        if (this.reconnectTimer)
            return;
        this.reconnectAttempts += 1;
        const backoff = delayMs ?? Math.min(this.reconnectAttempts * 2000, 30_000);
        logger_2.logger.info({ attempt: this.reconnectAttempts, inMs: backoff }, 'WhatsApp reconnect scheduled');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(() => { });
        }, backoff);
    }
    /** ارسال پیام متنی به شماره E.164 */
    async sendMessage(phone, message) {
        if (!this.isConnected() || !this.sock) {
            throw new errors_1.AppError('WHATSAPP_NOT_READY', 503);
        }
        const jid = `${phone}@s.whatsapp.net`;
        try {
            await this.sock.sendMessage(jid, { text: message });
        }
        catch (err) {
            logger_2.logger.error({ err: err.message }, 'WhatsApp send failed');
            throw new errors_1.AppError('OTP_SEND_FAILED', 502);
        }
    }
    /** خروج کامل و حذف session */
    async logout() {
        try {
            if (this.sock) {
                await this.sock.logout();
            }
        }
        catch (err) {
            logger_2.logger.warn({ err: err.message }, 'WhatsApp logout error (continuing)');
        }
        this.sock = null;
        this.state = 'disconnected';
        try {
            if (fs_1.default.existsSync(this.sessionDir)) {
                fs_1.default.rmSync(this.sessionDir, { recursive: true, force: true });
            }
        }
        catch (err) {
            logger_2.logger.error({ err: err.message }, 'Failed to remove session directory');
        }
        logger_2.logger.info('WhatsApp logged out and session removed');
    }
    /** خاموشی نرم — بدون حذف session */
    async end() {
        try {
            if (this.sock)
                await this.sock.end(undefined);
        }
        catch {
            /* noop */
        }
        this.sock = null;
        this.state = 'disconnected';
    }
}
exports.WhatsAppService = WhatsAppService;
