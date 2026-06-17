-- Supabase PostgreSQL Migration: Add status column to drivers table
-- Upstream: car-tracker backend

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Index for status lookups
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);