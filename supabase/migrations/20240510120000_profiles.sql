-- Run in Supabase SQL Editor (or via CLI) before using signup.
-- Auth: disable "Confirm email" in Authentication → Providers → Email for instant login.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  business_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);
