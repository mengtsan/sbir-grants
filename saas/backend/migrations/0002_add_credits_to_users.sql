-- Migration number: 0002
-- Add credit system to prevent Cloudflare AI API abuse
ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 50;
