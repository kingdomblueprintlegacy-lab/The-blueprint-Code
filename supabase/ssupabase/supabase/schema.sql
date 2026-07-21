-- ============================================================
-- THE BLUEPRINT CODE™ — SUPABASE SCHEMA
-- Kingdom Blueprint Legacy
--
-- Run this in the Supabase SQL Editor (or via `supabase db push`)
-- on a fresh project. Safe to re-run: uses IF NOT EXISTS guards
-- where practical, but review before running on a live database.
-- ============================================================

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- ============================================================
-- 1. PROFILES
-- One row per authenticated user. Created on sign-up.
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- ============================================================
-- 2. ASSESSMENT_RESULTS
-- ============================================================
create table if not exists public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_version text not null default 'v1',
  blueprint_season text,
  readiness_score numeric,
  primary_blocker text,
  top_priorities jsonb,
  core_strengths jsonb,
  dimension_scores jsonb,
  reflection_answers jsonb,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assessment_results enable row level security;

create policy "assessment_select_own" on public.assessment_results
  for select using (auth.uid() = user_id);

create policy "assessment_insert_own" on public.assessment_results
  for insert with check (auth.uid() = user_id);

create policy "assessment_update_own" on public.assessment_results
  for update using (auth.uid() = user_id);

-- ============================================================
-- 3. PURCHASES
-- Only the service role (Edge Functions) may write payment_status,
-- Stripe identifiers, and amount_paid. Customers may read only.
-- ============================================================
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  payment_status text not null default 'pending',
  amount_paid integer,
  currency text default 'usd',
  access_type text default 'lifetime',
  purchased_at timestamptz,
  refunded_at timestamptz,
  access_active boolean not null default false
);

alter table public.purchases enable row level security;

-- Customers may only READ their own purchase rows.
create policy "purchases_select_own" on public.purchases
  for select using (auth.uid() = user_id);

-- No insert/update policy is granted to the `authenticated` role.
-- This means customers CANNOT create or modify purchase records —
-- only the service-role key (used exclusively inside Edge Functions)
-- can insert or update rows here, because the service role bypasses
-- RLS by design in Supabase. Do not add authenticated insert/update
-- policies to this table.

-- ============================================================
-- 4. PRODUCT_ACCESS
-- Same lockdown as purchases: read-only for customers.
-- ============================================================
create table if not exists public.product_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  purchase_id uuid references public.purchases(id),
  access_type text default 'lifetime',
  access_granted_at timestamptz,
  access_revoked_at timestamptz,
  is_active boolean not null default true
);

alter table public.product_access enable row level security;

create policy "product_access_select_own" on public.product_access
  for select using (auth.uid() = user_id);

-- Intentionally no insert/update policy for `authenticated`.
-- Only the service role (Edge Functions) may grant or revoke access.

-- ============================================================
-- 5. JOURNEY_PROGRESS
-- ============================================================
create table if not exists public.journey_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  current_day integer default 1,
  current_week integer default 1,
  current_phase integer default 1,
  completion_percentage numeric default 0,
  completed_modules jsonb default '{}'::jsonb,
  completed_daily_actions jsonb default '{}'::jsonb,
  milestones jsonb default '[]'::jsonb,
  last_activity_at timestamptz not null default now()
);

alter table public.journey_progress enable row level security;

create policy "journey_progress_select_own" on public.journey_progress
  for select using (auth.uid() = user_id);
create policy "journey_progress_insert_own" on public.journey_progress
  for insert with check (auth.uid() = user_id);
create policy "journey_progress_update_own" on public.journey_progress
  for update using (auth.uid() = user_id);

-- ============================================================
-- 6. JOURNAL_ENTRIES
-- ============================================================
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  module_id text,
  prompt text,
  entry_text text not null,
  energy_rating integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.journal_entries enable row level security;

create policy "journal_select_own" on public.journal_entries
  for select using (auth.uid() = user_id);
create policy "journal_insert_own" on public.journal_entries
  for insert with check (auth.uid() = user_id);
create policy "journal_update_own" on public.journal_entries
  for update using (auth.uid() = user_id);
create policy "journal_delete_own" on public.journal_entries
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 7. WEEKLY_CHECK_INS
-- ============================================================
create table if not exists public.weekly_check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_number integer not null,
  responses jsonb,
  dimension_ratings jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_number)
);

alter table public.weekly_check_ins enable row level security;

create policy "checkins_select_own" on public.weekly_check_ins
  for select using (auth.uid() = user_id);
create policy "checkins_insert_own" on public.weekly_check_ins
  for insert with check (auth.uid() = user_id);
create policy "checkins_update_own" on public.weekly_check_ins
  for update using (auth.uid() = user_id);

-- ============================================================
-- 8. CERTIFICATES
-- ============================================================
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  certificate_reference text unique not null,
  completion_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.certificates enable row level security;

create policy "certificates_select_own" on public.certificates
  for select using (auth.uid() = user_id);
create policy "certificates_insert_own" on public.certificates
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- NOTES
-- ============================================================
-- 1. `purchases` and `product_access` deliberately have NO insert/
--    update policy for the `authenticated` role. Supabase's service
--    role key bypasses RLS entirely, so the Edge Functions
--    (create-checkout-session / stripe-webhook) can still write to
--    these tables using the service-role client, while ordinary
--    logged-in users cannot self-grant access, fake a payment
--    status, or edit Stripe identifiers from the browser.
--
-- 2. Consider adding a trigger on auth.users (after insert) that
--    creates a matching public.profiles row automatically, e.g.:
--
--    create or replace function public.handle_new_user()
--    returns trigger as $$
--    begin
--      insert into public.profiles (id, email)
--      values (new.id, new.email);
--      return new;
--    end;
--    $$ language plpgsql security definer;
--
--    create trigger on_auth_user_created
--      after insert on auth.users
--      for each row execute procedure public.handle_new_user();
--
-- 3. Review and tighten these policies for your exact business
--    rules before going live (e.g. adding admin-only read access
--    for support tooling).
