"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOTP = generateOTP;
exports.hashOTP = hashOTP;
exports.generateApiKey = generateApiKey;
exports.hashApiKey = hashApiKey;
const crypto_1 = __importDefault(require("crypto"));
/* ==================================================
   OTP utilities
   - تولید cryptographically secure
   - hash با HMAC-SHA256 + pepper
   OTP خام هرگز ذخیره یا log نمی‌شود
   ================================================== */
/** تولید کد OTP امن با crypto.randomInt (کریپتوگرافیک) */
function generateOTP(length) {
    const digits = [];
    for (let i = 0; i < length; i++) {
        digits.push(crypto_1.default.randomInt(0, 10).toString());
    }
    return digits.join('');
}
/** hash OTP با HMAC-SHA256 و pepper — برگشت‌پذیر نیست */
function hashOTP(code, pepper) {
    return crypto_1.default.createHmac('sha256', pepper).update(code).digest('hex');
}
/** تولید API Key جدید — فقط hash آن ذخیره می‌شود */
function generateApiKey(name) {
    const slug = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16) || 'CLIENT';
    const secret = crypto_1.default.randomBytes(24).toString('hex');
    return `OTPS_${slug}_${secret}`;
}
/** hash API Key — sha256 کافی است چون کلید با آنتروپی بالا تولید می‌شود */
function hashApiKey(apiKey) {
    return crypto_1.default.createHash('sha256').update(apiKey).digest('hex');
}
