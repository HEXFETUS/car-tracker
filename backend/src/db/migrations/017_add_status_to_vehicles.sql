-- Supabase PostgreSQL Migration: Add status column to vehicles table
-- Upstream: car-tracker backend

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Index for status lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles (status);