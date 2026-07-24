-- Migration: add due_date to production_orders
-- Run this once in the Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS due_date date;
