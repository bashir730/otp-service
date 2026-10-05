"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiRouter = createApiRouter;
const express_1 = require("express");
const apiKey_1 = require("../middleware/apiKey");
const rateLimit_1 = require("../middleware/rateLimit");
const otp_controller_1 = require("../controllers/otp.controller");
const otp_1 = require("../utils/otp");
const qrcode_1 = __importDefault(require("qrcode"));
function createApiRouter(deps) {
    const router = (0, express_1.Router)();
    const controller = new otp_controller_1.OTPController(deps.otp, deps.config);
    const requireKey = (0, apiKey_1.apiKeyAuth)(deps.db);
    const limit = (0, rateLimit_1.rateLimiter)(deps.redis, deps.config);
    /* ---------- OTP ---------- */
    const otp = (0, express_1.Router)();
    otp.post('/send', requireKey, limit, (req, res, next) => controller.send(req, res, next));
    otp.post('/verify', requireKey, limit, (req, res, next) => controller.verify(req, res, next));
    router.use('/otp', otp);
    /* ---------- Admin: مدیریت API clients ---------- */
    const clients = (0, express_1.Router)();
    clients.use((req, res, next) => {
        const key = req.headers['x-admin-key'];
        if (!key || String(key) !== deps.config.ADMIN_KEY) {
            res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Invalid admin key' });
            return;
        }
        next();
    });
    /* فهرست clients — بدون hash */
    clients.get('/', (_req, res) => {
        res.json({ success: true, clients: deps.db.listClients() });
    });
    /* ساخت client جدید — کلید خام فقط این یک بار برگردانده می‌شود */
    clients.post('/', (req, res) => {
        const name = String((req.body || {}).name || '').trim();
        if (name.length < 2 || name.length > 64) {
            res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'name must be 2-64 chars' });
            return;
        }
        const apiKey = (0, otp_1.generateApiKey)(name);
        const client = deps.db.createClient(name, (0, otp_1.hashApiKey)(apiKey));
        res.status(201).json({
            success: true,
            client: { id: client.id, name: client.name, active: !!client.active, created_at: client.created_at },
            apiKey
        });
    });
    /* فعال/غیرفعال کردن client */
    clients.patch('/:id', (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
            res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'invalid id' });
            return;
        }
        const active = !!(req.body || {}).active;
        deps.db.setClientActive(id, active);
        res.json({ success: true, id, active });
    });
    router.use('/clients', clients);
    /* ---------- Admin: صفحه اسکن QR (برای هاست بدون terminal مثل Render) ----------
       GET /api/v1/whatsapp/qr?key=ADMIN_KEY  → صفحه HTML با QR قابل اسکن
       GET /api/v1/whatsapp/qr?key=ADMIN_KEY&format=json → متن خام QR            */
    const wa = (0, express_1.Router)();
    wa.use((req, res, next) => {
        const key = req.query.key || req.headers['x-admin-key'];
        if (!key || String(key) !== deps.config.ADMIN_KEY) {
            res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Invalid admin key' });
            return;
        }
        next();
    });
    /* ---------- ورود با session (بدون QR) ----------
       GET  /api/v1/whatsapp/session?key=ADMIN_KEY  → فرم HTML برای paste کردن session
       POST /api/v1/whatsapp/session                  → body: {"session":"<json یا base64 creds.json>"}  */
    wa.get('/session', (_req, res) => {
        res.send(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورود با Session</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;background:#0b1220;color:#e8eefc;display:flex;justify-content:center;padding:24px}main{width:100%;max-width:560px}h2{margin:0 0 8px}p{color:#8ea0c0;font-size:13px}textarea{width:100%;height:180px;background:#111a2e;color:#e8eefc;border:1px solid #2c3a57;border-radius:12px;padding:12px;font-size:13px;box-sizing:border-box}button{margin-top:12px;width:100%;background:linear-gradient(135deg,#4f7cff,#7c5cff);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;cursor:pointer}#r{margin-top:14px;padding:12px;border-radius:12px;font-size:14px;display:none;white-space:pre-wrap}</style></head>
<body><main><h2>🔑 ورود با Session</h2>
<p>محتوای creds.json (یا رشته base64 آن) را از ابزار ساخت session خود paste کن و ثبت کن — بدون QR وصل می‌شود.</p>
<textarea id="t" placeholder='{"noiseKey":...} یا رشته base64'></textarea>
<button onclick="go()">ثبت و اتصال</button>
<div id="r"></div>
<script>
async function go(){
  const v=document.getElementById('t').value.trim();
  const r=document.getElementById('r'); r.style.display='block';
  if(!v){r.style.background='#2b0d13';r.textContent='خالی است';return;}
  try{
    const res=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':new URLSearchParams(location.search).get('key')},body:JSON.stringify({session:v})});
    const d=await res.json();
    r.style.background=d.success?'#0d2b1e':'#2b0d13';
    r.textContent=d.success?('✅ session شماره '+d.user+' ثبت شد — در حال اتصال'):('❌ '+(d.message||d.error));
  }catch(e){r.style.background='#2b0d13';r.textContent='❌ '+e.message;}
}
</script></main></body></html>`);
    });
    wa.post('/session', async (req, res) => {
        const { session } = (req.body || {});
        if (!session || typeof session !== 'string' || session.length < 50) {
            res.status(400).json({ success: false, error: 'INVALID_SESSION', message: 'Session data missing or too short' });
            return;
        }
        let creds = null;
        /* JSON مستقیم */
        try {
            creds = JSON.parse(session);
        }
        catch { /* نه JSON — base64 را امتحان کن */ }
        if (!creds) {
            try {
                const decoded = Buffer.from(session.trim(), 'base64').toString('utf-8');
                creds = JSON.parse(decoded);
            }
            catch { /* پایین‌تر error می‌دهیم */ }
        }
        try {
            const { user } = await deps.whatsapp.importSession(creds);
            res.json({ success: true, user, message: 'Session imported — connecting' });
        }
        catch (err) {
            const e = err;
            res.status(e.status ?? 400).json({ success: false, error: e.code ?? 'INVALID_SESSION', message: e.message });
        }
    });
    wa.get('/qr', async (req, res) => {
        const qr = deps.whatsapp.getLastQr();
        if (!qr) {
            res.json({
                success: true,
                connected: deps.whatsapp.isConnected(),
                state: deps.whatsapp.getState(),
                qr: null,
                message: deps.whatsapp.isConnected()
                    ? 'WhatsApp already connected'
                    : 'QR not ready yet — retry in a few seconds'
            });
            return;
        }
        if (req.query.format === 'json') {
            res.json({ success: true, state: deps.whatsapp.getState(), qr });
            return;
        }
        const dataUrl = await qrcode_1.default.toDataURL(qr, { width: 512, margin: 2 });
        res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OTP-Service — WhatsApp QR</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e8eefc;display:flex;flex-direction:column;align-items:center;padding:24px;gap:12px}img{background:#fff;padding:12px;border-radius:12px;max-width:90vw}p{opacity:.8;text-align:center}</style></head>
<body><h2>📱 WhatsApp — Link a Device</h2><img src="${dataUrl}" alt="QR"><p>WhatsApp → Settings → Linked Devices → Link a Device</p><p>اگر connected شد این صفحه را رفرش کنید — پیام موفقیت می‌آید</p></body></html>`);
    });
    router.use('/whatsapp', wa);
    return router;
}
