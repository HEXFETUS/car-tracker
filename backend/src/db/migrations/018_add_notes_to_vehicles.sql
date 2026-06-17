-- Supabase PostgreSQL Migration: Add notes column to vehicles table
-- Upstream: car-tracker backend

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes TEXT;