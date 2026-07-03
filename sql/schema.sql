-- ============================================================================
-- SCHOOL APP — CORE DATABASE SCHEMA
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ROLES TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.roles (
  role_id     uuid primary key default gen_random_uuid(),
  role_name   text unique not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

comment on table public.roles is 'Roles that can be assigned to users. Admin can add new rows here.';

-- ----------------------------------------------------------------------------
-- 2. USERS TABLE (profile row that extends Supabase auth.users)
-- ----------------------------------------------------------------------------
-- NOTE ON PASSWORDS:
-- Supabase Auth (auth.users) already stores a securely hashed password for
-- every account. We deliberately do NOT duplicate a plaintext/raw password
-- column in public.users — that would be a serious security weakness.
-- Login/registration/password-change all go through supabase.auth, and this
-- table only holds the profile + workflow fields (status, role, audit).
create table if not exists public.users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  mobile_no   text not null,
  role_id     uuid references public.roles(role_id),
  status      text not null default 'pending'
              check (status in ('pending', 'active', 'deactivated')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id)
);

comment on table public.users is 'Profile + approval/role/status info for every account. Row is created at registration with status=pending; admin approves + assigns role.';

create index if not exists idx_users_role on public.users(role_id);
create index if not exists idx_users_status on public.users(status);

-- ----------------------------------------------------------------------------
-- 3. AUDIT LOG TABLE (generic — every module page should write here)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  log_id            bigserial primary key,
  table_name        text not null,
  record_id         text not null,
  action            text not null check (action in ('insert','update','delete')),
  changed_by        uuid references auth.users(id),
  changed_by_username text,
  changed_at        timestamptz not null default now(),
  old_data          jsonb,
  new_data          jsonb
);

comment on table public.audit_log is 'Generic "who did what, when" trail. Every module page calls logAudit() from common.js after insert/update/delete.';

create index if not exists idx_audit_table_record on public.audit_log(table_name, record_id);
create index if not exists idx_audit_changed_at on public.audit_log(changed_at desc);

-- ----------------------------------------------------------------------------
-- 4. HELPER FUNCTIONS (used inside RLS policies on every module table)
-- ----------------------------------------------------------------------------

-- current logged-in user's role name, or null if not found/not active
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.role_name
  from public.users u
  join public.roles r on r.role_id = u.role_id
  where u.user_id = auth.uid()
    and u.status = 'active'
  limit 1;
$$;

-- current logged-in user's username (for stamping created_by_username etc.)
create or replace function public.current_username()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select username from public.users where user_id = auth.uid() limit 1;
$$;

-- convenience: is the current user an active admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() = 'admin';
$$;

-- auto-maintain updated_at on any table that has the column
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.audit_log enable row level security;

-- ROLES: any active logged-in user can read the role list (needed for dropdowns);
-- only admin can create/edit roles.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select using (auth.uid() is not null);

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert with check (public.is_admin());

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update using (public.is_admin());

-- USERS: a user can read/update their own row (e.g. change password flow,
-- reading their own status/role). Admin can read/update everyone, and approve
-- pending accounts. Registration (insert) is allowed for a brand-new auth
-- user inserting their OWN row only.
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
  for insert with check (auth.uid() = user_id);

drop policy if exists users_update_self_or_admin on public.users;
create policy users_update_self_or_admin on public.users
  for update using (auth.uid() = user_id or public.is_admin());

-- AUDIT LOG: any active user can insert an audit row (as themselves);
-- only admin can read the full log.
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert with check (auth.uid() is not null);

drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log
  for select using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. SEED DATA — default roles
-- ----------------------------------------------------------------------------
insert into public.roles (role_name)
  values ('admin'), ('editor'), ('viewer')
on conflict (role_name) do nothing;

-- ----------------------------------------------------------------------------
-- 7. PRIMARY ADMIN ACCOUNT
-- ----------------------------------------------------------------------------
-- This CANNOT be fully scripted in plain SQL because the password must be
-- created through Supabase Auth (so it is hashed correctly). Do ONE of:
--
-- OPTION A (recommended, 2 minutes, no code):
--   1. Supabase Dashboard → Authentication → Users → "Add user"
--        email:            admin@school.internal   (any placeholder domain)
--        password:         Admin@1998
--        Auto Confirm User: ON
--   2. Copy the new user's UUID, then run in SQL Editor:
--
--      insert into public.users (user_id, username, mobile_no, role_id, status, created_by, updated_by)
--      select '<PASTE-UUID-HERE>', 'admin', '0000000000', role_id, 'active', '<PASTE-UUID-HERE>', '<PASTE-UUID-HERE>'
--      from public.roles where role_name = 'admin';
--
-- OPTION B: run scripts/seed-admin.js included in this project (uses the
-- Supabase service_role key, never expose that key in the browser/front-end).
--
-- After this, the user logs in with Username: admin  Password: Admin@1998
-- (see assets/js/config.js EMAIL_DOMAIN — the app converts "admin" to
-- "admin@school.internal" automatically, the user never types an email).
