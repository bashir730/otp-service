# otp-service

**Central OTP Verification Service** — یک حساب WhatsApp (با Baileys) متصل می‌شود و برای همه اپلیکیشن‌ها، وب‌سایت‌ها و بات‌های شما به‌عنوان سرویس مرکزی ارسال و تأیید OTP عمل می‌کند.

```
Website / App / Bot
        │
        │ HTTPS REST API (Bearer API Key)
        ▼
   Express API ── Helmet / CORS / Zod / Rate Limit
        │
   ┌────┴─────┐
   ▼          ▼
 Redis      SQLite        (Redis قطع؟ → fallback درون‌حافظه‌ای)
   │
   ▼
 OTP Service
   │
   ▼
 WhatsAppService
   │
   ▼
 Baileys ── WhatsApp ── User receives OTP
```

| تکنولوژی | استفاده |
|---|---|
| Node.js + TypeScript | کل سرویس |
| Express.js | REST API |
| Baileys | اتصال WhatsApp و ارسال پیام |
| SQLite (better-sqlite3) | ذخیره‌سازی دائمی (clients, otp_requests, logs) |
| Redis (ioredis) | داده موقت، rate limiting (با fallback) |
| Pino | logging |
| Zod | validation |
| Helmet + CORS | امنیت HTTP |
| PM2 | اجرای 24/7 |

---

## 1) معرفی پروژه

ویژگی‌های اصلی:

* OTP شش‌رقمی، تولید‌شده با `crypto.randomInt` (کریپتوگرافیک امن)
* اعتبار ۵ دقیقه، فقط یک‌بار قابل استفاده، حداکثر ۵ تلاش
* OTP خام **هرگز** در دیتابیس یا log ذخیره نمی‌شود — فقط hash (HMAC-SHA256 + pepper)
* هر پروژه (NOVA-WEB, NOVA-ANDROID, NOVA-BOT...) API Key مخصوص خودش را دارد؛ فقط hash کلید در دیتابیس
* Rate limiting سه‌لایه: هر IP، هر شماره، هر API Client
* نرمال‌سازی شماره به E.164 (پشتیبانی بین‌المللی، پیش‌فرض افغانستان)
* Reconnect خودکار WhatsApp بدون crash؛ session خراب به‌صورت کنترل‌شده پاک و QR جدید صادر می‌شود
* اگر Redis قطع باشد سرویس با fallback درون‌حافظه‌ای ادامه می‌دهد
* Graceful shutdown، secure error handling (بدون stack trace به بیرون)

---

## 2) Requirements

* Node.js نسخه ۱۸ یا بالاتر (توصیه: ۲۰+)
* Redis (اختیاری ولی توصیه‌شده؛ بدون آن هم سرویس کار می‌کند)
* Linux VPS برای production (Ubuntu/Debian)

---

## 3) نصب Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

---

## 4) نصب Redis

```bash
sudo apt-get install -y redis-server
sudo systemctl enable redis-server --now
redis-cli ping   # باید PONG برگرداند
```

اگر Redis ندارید، سرویس با fallback درون‌حافظه‌ای کار می‌کند (تست‌شده) — ولی در production با چند process توصیه نمی‌شود.

---

## 5) نصب dependencies

```bash
cd otp-service
npm install
npm run build
```

---

## 6) تنظیم .env

```bash
cp .env.example .env
nano .env
```

مقادیر مهم:

* `ADMIN_KEY` — کلید مدیریت API clients (طولانی و تصادفی)
* `OTP_PEPPER` — رشته تصادفی بلند برای hash کردن OTP؛ **ثابت نگه‌دارید** وگرنه OTPها بعد از restart معتبر نمی‌مانند
* `OTP_MESSAGE_TEMPLATE` — متن پیام؛ `{code}` و `{minutes}` جایشان عوض می‌شوند
* `DEFAULT_REGION` — کد منطقه برای نرمال‌سازی شماره‌های محلی (پیش‌فرض `AF`)
* `RATE_LIMIT_*` — سقف درخواست در دقیقه

---

## 7) اجرای پروژه

```bash
# development
npm run dev

# production
npm run build
npm start
```

آدرس‌ها:

* `GET /` — معرفی سرویس
* `GET /api/v1/health` — وضعیت سرویس‌ها
* `POST /api/v1/otp/send` — ارسال OTP
* `POST /api/v1/otp/verify` — تأیید OTP
* `GET|POST /api/v1/clients` — مدیریت API clients (با `x-admin-key`)

---

## 8) اتصال WhatsApp

اولین اجرا با `WHATSAPP_AUTO_CONNECT=true` (پیش‌فرض) به WhatsApp وصل می‌شود. اگر session وجود نداشته باشد:

```
📱 WhatsApp authentication required — scan QR code in terminal
█▀▀▀▀▀█ ...█ ...
█▄▄▄▄▄█ ...
```

Session در `auth/baileys-session/` ذخیره می‌شود؛ بعد از restart **دیگر QR لازم نیست**.

قطع شدن:

* قطع موقت → reconnect خودکار با backoff
* `loggedOut` (session حذف‌شده/خراب) → پاکسازی کنترل‌شده‌ی session و QR جدید

نکته: این سرویس باید **فقط یک حساب WhatsApp** را متصل کند و همیشه روشن بماند. اگر همان حساب را جای دیگری هم متصل کنید WhatsApp یکی را حذف می‌کند.

---

## 9) Scan QR

1. `npm run dev` را اجرا کنید
2. QR را در terminal ببینید
3. در موبایل: `WhatsApp → Settings → Linked Devices → Link a Device`
4. QR را اسکن کنید
5. پیام `WhatsApp connected` را می‌بینید

**مهم:** اگر پروژه را روی VPS اجرا می‌کنید و terminal ندارید، با `pm2 logs otp-service` یا `journalctl` خروجی را ببینید یا با `tmux`/`screen` اجرا کنید تا QR را ببینید.

---

## 10) ساخت API Client

هر پروژه‌ای که از این سرویس استفاده می‌کند یک API Key مخصوص دارد.

**روش ۱ — CLI:**

```bash
npm run client:add -- NOVA-WEB
```

خروجی:

```
✅ API client created
   Name : NOVA-WEB
   Key  : OTPS_NOVAWEB_bbaa4959da99ecc89f5c37c7bde9df8c74ccd10af23abfc5
⚠️  Save this key now — it will NOT be shown again.
```

**روش ۲ — Admin API:**

```bash
curl -X POST http://localhost:3000/api/v1/clients \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"name":"NOVA-ANDROID"}'
```

مدیریت:

```bash
# فهرست clients
curl http://localhost:3000/api/v1/clients -H "x-admin-key: YOUR_ADMIN_KEY"

# غیرفعال/فعال کردن
curl -X PATCH http://localhost:3000/api/v1/clients/1 \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"active": false}'
```

---

## 11) استفاده از /otp/send

```bash
curl -X POST http://localhost:3000/api/v1/otp/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OTPS_NOVAWEB_..." \
  -d '{"phone": "+937XXXXXXXX", "purpose": "login"}'
```

Response موفق:

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "expiresIn": 300
}
```

قواعد:

* شماره با هر فرمتی (`+937...`, `937...`, `00937...`, فرمت محلی) به E.164 نرمال می‌شود
* حداکثر ۱ OTP برای هر شماره/هدف در `OTP_RESEND_SECONDS` ثانیه
* درخواست جدید، OTP قبلی همان شماره/هدف را باطل می‌کند
* متن پیام از `OTP_MESSAGE_TEMPLATE` خوانده می‌شود

---

## 12) استفاده از /otp/verify

```bash
curl -X POST http://localhost:3000/api/v1/otp/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OTPS_NOVAWEB_..." \
  -d '{"phone": "+937XXXXXXXX", "code": "482731", "purpose": "login"}'
```

موفق:

```json
{ "success": true, "verified": true }
```

ناموفق:

```json
{ "success": false, "verified": false, "error": "INVALID_OTP" }
```

نکته: `phone` و `purpose` باید همان مقادیر send باشند. OTP بعد از تأیید مصرف می‌شود (replay ممکن نیست).

---

## 13) Error codes

| کد | HTTP | معنی |
|---|---|---|
| `INVALID_PHONE` | 400 | شماره نامعتبر |
| `VALIDATION_ERROR` | 400 | بدنه درخواست نامعتبر |
| `OTP_EXPIRED` | 400 | کد منقضی شده |
| `INVALID_OTP` | 400 | کد اشتباه/مصرف‌شده/وجود ندارد |
| `TOO_MANY_ATTEMPTS` | 429 | بیش از حد مجاز تلاش (ضد brute-force) |
| `RATE_LIMITED` | 429 | rate limit هر IP / شماره / client |
| `UNAUTHORIZED` | 401 | کلید غایب یا نامعتبر |
| `CLIENT_INACTIVE` | 403 | client غیرفعال است |
| `WHATSAPP_NOT_READY` | 503 | WhatsApp قطع است |
| `OTP_SEND_FAILED` | 502 | ارسال پیام شکست خورد |
| `INTERNAL_ERROR` | 500 | خطای داخلی (بدون جزئیات) |
| `NOT_FOUND` | 404 | مسیر ناموجود |

فرمت همه خطاها: `{ "success": false, "error": "...", "message": "..." }` — هیچ stack trace یا اطلاعات حساسی به بیرون نمی‌رود.

---

## 14) Security

* OTP: hash با HMAC-SHA256 + pepper؛ کد خام فقط در حافظه و پیام WhatsApp
* API Key: فقط sha256 hash در دیتابیس؛ کلید خام فقط یک‌بار هنگام ساخت نمایش داده می‌شود
* Rate limiting سه‌لایه + سقف attempts + باطل شدن خودکار کد قبلی
* Zod روی همه ورودی‌ها؛ JSON payload محدود به 16KB
* Helmet, CORS قابل تنظیم, `x-powered-by` خاموش
* لاگ‌ها OTP و کلید را شامل نمی‌شوند (pino redact + عدم log عمدی)
* این فایل‌ها هرگز داخل Git نمی‌روند (در `.gitignore` هستند):
  * `.env`
  * `auth/` (session و credentials واتساپ)
  * `data/` (دیتابیس SQLite)

**هشدار:** فایل‌های `auth/baileys-session/` معادل ورود به حساب WhatsApp شما هستند؛ هرگز به کسی ندهید و کامیت نکنید.

---

## 15) Deployment (Linux VPS + PM2)

```bash
# روی سرور
git clone <your-private-repo> && cd otp-service
npm install
cp .env.example .env && nano .env     # ADMIN_KEY و OTP_PEPPER را تنظیم کنید
npm run build

# اولین بار برای اسکن QR با tmux:
tmux new -s otp
npm start
# QR را اسکن کنید، بعد از اتصال: Ctrl+B سپس D برای خروج از tmux

# با PM2:
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # اجرای خودکار بعد از reboot
```

توصیه‌های production:

* پشت Nginx/Caddy با HTTPS بگذارید؛ پورت 3000 را به اینترنت باز نکنید
* UFW: فقط 22 و 443 باز
* لاگ‌ها: `pm2 logs otp-service`
* مانیتورینگ: `GET /api/v1/health` را در uptime-monitor خود بگذارید

نمونه Nginx:

```nginx
server {
    listen 443 ssl;
    server_name otp.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 16) Backup

```bash
# دیتابیس (بهترین زمان: وقتی سرویس روشن است به‌خاطر WAL، ولی امن است)
sqlite3 data/otp.sqlite ".backup /backup/otp-$(date +%F).sqlite"

# session واتساپ (برای بازیابی بعد از خرابی سرور)
tar czf /backup/baileys-session-$(date +%F).tar.gz auth/baileys-session/

# کرون روزانه:
# 0 3 * * * cd /opt/otp-service && sqlite3 data/otp.sqlite ".backup /backup/otp-$(date +\%F).sqlite"
```

بازیابی: فایل‌ها را جایگزین کنید و `pm2 restart otp-service`.

---

## 17) Troubleshooting

| مشکل | راه‌حل |
|---|---|
| QR نمایش داده نمی‌شود | `pm2 logs otp-service` یا با tmux اجرا کنید؛ QR فقط در terminal چاپ می‌شود |
| بعد از restart دوباره QR می‌خواهد | `auth/baileys-session/` وجود دارد؟ پرمیشن نوشتن؟ اگر حساب از جای دیگری logout شده، session پاک شده |
| `WHATSAPP_NOT_READY` | اتصال قطع است؛ چند لحظه صبر کنید (reconnect خودکار)؛ health را چک کنید |
| `RATE_LIMITED` | سقف resend/شماره/IP؛ سقفها را در `.env` تنظیم کنید |
| Redis قطع | سرویس با fallback کار می‌کند؛ لاگ را چک کنید و Redis را بالا بیاورید |
| `better-sqlite3` ارور نصب | `sudo apt-get install -y build-essential python3` بعد `npm rebuild better-sqlite3` |
| حساب از بات دیگر قطع می‌شود | یک شماره WhatsApp فقط به یک سرویس متصل باشد؛ شماره دوم بگیرید |

---

## Testing

```bash
npm test
```

۲۶ تست: جریان کامل send/verify، کد اشتباه، انقضا، reuse، سقف تلاش‌ها، resend، rate limit شماره و IP، کلید غایب/نامعتبر، client غیرفعال، مدیریت clients، Redis قطع، SQLite قطع، WhatsApp قطع، health.

---

## ساختار پروژه

```
otp-service/
├── src/
│   ├── server.ts                 # نقطه ورود + graceful shutdown
│   ├── app.ts                    # ساخت Express app (تست‌پذیر)
│   ├── config/config.ts          # .env با Zod validation
│   ├── routes/
│   │   ├── otp.routes.ts         # /otp/send, /otp/verify, /clients
│   │   └── health.routes.ts      # /health
│   ├── controllers/otp.controller.ts
│   ├── services/
│   │   ├── otp.service.ts        # کل منطق OTP
│   │   ├── whatsapp.service.ts  # لایه مستقل Baileys
│   │   ├── redis.service.ts     # rate limit + fallback
│   │   └── database.service.ts  # SQLite + migrations
│   ├── middleware/
│   │   ├── apiKey.ts             # Bearer authentication
│   │   ├── rateLimit.ts          # IP + client limits
│   │   └── errorHandler.ts       # فرمت امن خطاها
│   ├── database/
│   │   ├── schema.sql
│   │   └── migrations/
│   ├── scripts/add-client.ts     # CLI ساخت API client
│   └── utils/                    # logger, errors, otp, phone
├── tests/otp-api.test.ts
├── auth/baileys-session/         # (gitignored)
├── data/otp.sqlite               # (gitignored)
├── ecosystem.config.cjs          # PM2
└── .env / .env.example / .gitignore
```
