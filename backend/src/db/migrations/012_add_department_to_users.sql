-- Supabase PostgreSQL Migration: Add department column to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';