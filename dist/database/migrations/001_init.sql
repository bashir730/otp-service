-- Migration 001: پایه — ایندکس‌های تکمیلی
-- جدول‌های اصلی در schema.sql ساخته می‌شوند؛ این migration
-- برای اولین بار ثبت می‌شود تا سازوکار migration تست شده باشد.

CREATE INDEX IF NOT EXISTS idx_clients_active ON api_clients(active);
