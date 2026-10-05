"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const otp_routes_1 = require("./routes/otp.routes");
const health_routes_1 = require("./routes/health.routes");
const errorHandler_1 = require("./middleware/errorHandler");
/* ==================================================
   createApp — برای تست‌پذیری، dependencies تزریق می‌شوند
   ================================================== */
function createApp(deps) {
    const app = (0, express_1.default)();
    /* امنیت */
    app.disable('x-powered-by');
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({
        origin: deps.config.CORS_ORIGIN === '*' ? true : deps.config.CORS_ORIGIN.split(',').map((o) => o.trim()),
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
    }));
    /* بدنه JSON محدود — جلوگیری از payload بزرگ */
    app.use(express_1.default.json({ limit: '16kb' }));
    /* صفحه ریشه — معرفی سرویس */
    app.get('/', (_req, res) => {
        res.json({
            service: 'otp-service',
            version: '1.0.0',
            health: '/api/v1/health'
        });
    });
    /* مسیرهای API */
    app.use('/api/v1/health', (0, health_routes_1.createHealthRouter)(deps));
    app.use('/api/v1', (0, otp_routes_1.createApiRouter)(deps));
    /* 404 + error handler */
    app.use(errorHandler_1.notFoundHandler);
    app.use(errorHandler_1.errorHandler);
    return app;
}
