-- Migration 000020: Persist single-use delivery OTP hint strictly for ONLINE paid orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_otp_hint VARCHAR(8) NULL;
