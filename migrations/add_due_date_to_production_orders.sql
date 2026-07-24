-- Add due_date to production_orders
-- Run this in the Supabase SQL Editor before using the Due Date field.
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS due_date date;
