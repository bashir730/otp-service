"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTPController = void 0;
const zod_1 = require("zod");
const phone_1 = require("../utils/phone");
const errors_1 = require("../utils/errors");
/* ==================================================
   OTP Controller — validation با Zod + مدیریت خطا
   ================================================== */
const sendSchema = zod_1.z.object({
    phone: zod_1.z.string().min(5).max(20),
    purpose: zod_1.z.string().trim().min(2).max(50).default('login')
});
const verifySchema = zod_1.z.object({
    phone: zod_1.z.string().min(5).max(20),
    code: zod_1.z.string().regex(/^\d{4,8}$/, 'invalid code'),
    purpose: zod_1.z.string().trim().min(2).max(50).default('login')
});
class OTPController {
    otp;
    config;
    constructor(otp, config) {
        this.otp = otp;
        this.config = config;
    }
    /* POST /api/v1/otp/send */
    async send(req, res, next) {
        try {
            const body = sendSchema.parse(req.body || {});
            const phone = (0, phone_1.normalizePhone)(body.phone, this.config.DEFAULT_REGION);
            if (!phone)
                throw new errors_1.AppError('INVALID_PHONE', 400);
            const result = await this.otp.sendOTP(req.clientId, phone, body.purpose, req.ip || null);
            /* کد خام در response برنمی‌گردد (کلاینت فقط وضعیت می‌خواهد) */
            res.status(200).json({
                success: true,
                message: 'OTP sent successfully',
                expiresIn: result.expiresIn
            });
        }
        catch (err) {
            next(err);
        }
    }
    /* POST /api/v1/otp/verify */
    async verify(req, res, next) {
        try {
            const body = verifySchema.parse(req.body || {});
            const phone = (0, phone_1.normalizePhone)(body.phone, this.config.DEFAULT_REGION);
            if (!phone)
                throw new errors_1.AppError('INVALID_PHONE', 400);
            await this.otp.verifyOTP(req.clientId, phone, body.purpose, body.code, req.ip || null);
            res.status(200).json({ success: true, verified: true });
        }
        catch (err) {
            next(err);
        }
    }
}
exports.OTPController = OTPController;
