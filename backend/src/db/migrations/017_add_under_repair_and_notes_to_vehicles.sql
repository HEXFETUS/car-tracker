-- Supabase PostgreSQL Migration: Add under_repair (boolean) and notes columns to vehicles table
-- Upstream: car-tracker backend

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS under_repair BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes TEXT;