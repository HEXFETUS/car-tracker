-- Add receipt_number and attached_picture columns to maintenance table

ALTER TABLE maintenance
  ADD COLUMN IF NOT EXISTS receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS attached_picture TEXT;