-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- SUPERSEDED — DO NOT EXECUTE THIS FILE STANDALONE
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- This is the original schema definition file, retained for historical
-- reference only. It contains permissive anon RLS policies that are now
-- intentionally absent from the live hardened database.
--
-- Running THIS file standalone would (among many other effects):
--   • Recreate "anon_all_products" ON public.products
--     FOR ALL TO anon USING (true) WITH CHECK (true) —
--     grants anon full read/write/delete access to ALL product rows across
--     all companies. The live database intentionally has NO anon access
--     to public.products.
--   • Recreate "anon_all_production_orders" ON public.production_orders
--     FOR ALL TO anon USING (true) WITH CHECK (true) —
--     grants anon full read/write/delete access to ALL production order
--     rows across all companies. The live database intentionally has NO
--     anon access to public.production_orders.
--   • Recreate similar anon_all_* policies on suppliers, raw_materials,
--     sales, quality_inspections, quality_defects — all absent in live DB.
--
-- The live anon grant revocations are recorded in:
--   supabase_log_scan_event_hardening_20260819.sql
--     (scan_events: anon grants revoked, SECURITY DEFINER path only)
--   supabase_public_trace_table_hardening_20260820.sql
--     (products, production_orders: anon grants revoked)
--
-- If you must re-run this file for schema recovery, run BOTH hardening
-- files immediately afterwards to restore the hardened state.
--
-- This file is retained for historical reference only.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- =============================================================
-- TraceFlow – Complete Supabase Schema
-- Run this entire file in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/<your-project>/sql
-- =============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── 1. products ──────────────────────────────────────────────
create table if not exists public.products (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  sku         text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

-- ── 2. suppliers ─────────────────────────────────────────────
create table if not exists public.suppliers (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  contact_email text,
  contact_phone text,
  created_at    timestamptz not null default now()
);

-- ── 3. raw_materials ─────────────────────────────────────────
create table if not exists public.raw_materials (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,
  unit              text not null,
  quantity_in_stock numeric not null default 0,
  reorder_level     numeric not null default 0,
  supplier_id       uuid references public.suppliers (id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ── 4. production_orders ─────────────────────────────────────
create table if not exists public.production_orders (
  id           uuid primary key default uuid_generate_v4(),
  product_id   uuid not null references public.products (id) on delete cascade,
  quantity     integer not null check (quantity > 0),
  status       text not null default 'pending'
                 check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ── 5. bom_usage (bill-of-materials per order) ───────────────
create table if not exists public.bom_usage (
  id                  uuid primary key default uuid_generate_v4(),
  production_order_id uuid not null references public.production_orders (id) on delete cascade,
  raw_material_id     uuid not null references public.raw_materials (id) on delete restrict,
  quantity_used       numeric not null check (quantity_used > 0),
  created_at          timestamptz not null default now()
);

-- ── 6. qc_results ────────────────────────────────────────────
-- Used by the dashboard (lib/dashboard.ts) for the QC pass-rate widget.
create table if not exists public.qc_results (
  id                  uuid primary key default uuid_generate_v4(),
  production_order_id uuid not null references public.production_orders (id) on delete cascade,
  passed              boolean not null,
  notes               text,
  inspected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- ── 7. sales ─────────────────────────────────────────────────
-- Columns required by useSales.ts and lib/dashboard.ts
create table if not exists public.sales (
  id            uuid primary key default uuid_generate_v4(),
  product_id    uuid references public.products (id) on delete set null,
  product_name  text,                          -- denormalised for display
  quantity      integer not null check (quantity > 0),
  unit_price    numeric,
  total_price   numeric not null default 0,
  customer_name text,
  status        text not null default 'completed'
                  check (status in ('completed', 'pending', 'cancelled', 'refunded')),
  sold_at       timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ── 8. quality_inspections ───────────────────────────────────
-- Used by useQualityInspections.ts and the Quality Control page
create table if not exists public.quality_inspections (
  id              uuid primary key default uuid_generate_v4(),
  batch_id        text not null,
  inspector_id    text not null,
  inspection_date date not null default current_date,
  inspection_type text not null
                    check (inspection_type in ('incoming', 'in_process', 'final', 'random')),
  status          text not null default 'pending'
                    check (status in ('pending', 'passed', 'failed', 'conditional')),
  overall_score   numeric not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- auto-update updated_at on every row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quality_inspections_updated_at on public.quality_inspections;
create trigger quality_inspections_updated_at
  before update on public.quality_inspections
  for each row execute function public.set_updated_at();

-- ── 9. quality_defects ───────────────────────────────────────
create table if not exists public.quality_defects (
  id                uuid primary key default uuid_generate_v4(),
  inspection_id     uuid not null references public.quality_inspections (id) on delete cascade,
  defect_type       text not null,
  severity          text not null default 'minor'
                      check (severity in ('minor', 'major', 'critical')),
  quantity          integer not null default 1 check (quantity > 0),
  description       text,
  corrective_action text,
  resolved          boolean not null default false,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- =============================================================
-- Row-Level Security
-- Enable RLS on every table, then grant full access to the
-- anon role so the app works without authentication.
-- Tighten these policies when you add auth.
-- =============================================================

alter table public.products            enable row level security;
alter table public.suppliers           enable row level security;
alter table public.raw_materials       enable row level security;
alter table public.production_orders   enable row level security;
alter table public.bom_usage           enable row level security;
alter table public.qc_results          enable row level security;
alter table public.sales               enable row level security;
alter table public.quality_inspections enable row level security;
alter table public.quality_defects     enable row level security;

-- Helper: create anon-access policies for a table
-- (select, insert, update, delete all allowed)

create policy "anon_all_products"            on public.products            for all to anon using (true) with check (true);
create policy "anon_all_suppliers"           on public.suppliers           for all to anon using (true) with check (true);
create policy "anon_all_raw_materials"       on public.raw_materials       for all to anon using (true) with check (true);
create policy "anon_all_production_orders"   on public.production_orders   for all to anon using (true) with check (true);
create policy "anon_all_bom_usage"           on public.bom_usage           for all to anon using (true) with check (true);
create policy "anon_all_qc_results"          on public.qc_results          for all to anon using (true) with check (true);
create policy "anon_all_sales"               on public.sales               for all to anon using (true) with check (true);
create policy "anon_all_quality_inspections" on public.quality_inspections for all to anon using (true) with check (true);
create policy "anon_all_quality_defects"     on public.quality_defects     for all to anon using (true) with check (true);

-- =============================================================
-- Optional sample data – remove if you don't want seed rows
-- =============================================================

insert into public.products (name, sku, description) values
  ('Steel Bolt M8',    'BOLT-M8-001',  'Standard M8 hex bolt, grade 8.8'),
  ('Aluminum Bracket', 'BRKT-AL-002',  'L-shaped mounting bracket'),
  ('Rubber Gasket',    'GASK-RB-003',  'Oil-resistant rubber gasket')
on conflict (sku) do nothing;

insert into public.raw_materials (name, unit, quantity_in_stock, reorder_level) values
  ('Steel Rod',     'kg',  250, 50),
  ('Aluminum Sheet','kg',  80,  30),
  ('Rubber Sheet',  'pcs', 15,  20)
on conflict do nothing;

insert into public.sales (product_name, quantity, unit_price, total_price, customer_name, status, sold_at) values
  ('Steel Bolt M8',    100, 0.85,  85.00,  'Acme Corp',      'completed', now() - interval '1 day'),
  ('Aluminum Bracket',  25, 12.50, 312.50, 'BuildRight Ltd',  'completed', now() - interval '3 days'),
  ('Rubber Gasket',     50, 3.20,  160.00, 'TechParts Inc',   'pending',   now() - interval '5 days')
on conflict do nothing;

insert into public.quality_inspections (batch_id, inspector_id, inspection_date, inspection_type, status, overall_score, notes) values
  ('BATCH-2026-001', 'inspector-1', current_date - 2, 'final',    'passed', 95, 'All checks passed.'),
  ('BATCH-2026-002', 'inspector-2', current_date - 1, 'incoming', 'failed', 62, 'Surface defects found.'),
  ('BATCH-2026-003', 'inspector-1', current_date,     'random',   'passed', 88, NULL)
on conflict do nothing;
