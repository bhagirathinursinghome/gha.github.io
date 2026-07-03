-- ============================================================================
-- EXAMPLE MODULE TABLE — "Notice Board"
-- This is the worked example referenced in HOW_TO_ADD_PAGE.md.
-- Copy this pattern for every new page that stores its own data.
-- ============================================================================

create table if not exists public.notices (
  notice_id     uuid primary key default gen_random_uuid(),
  title         text not null,
  message       text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

drop trigger if exists trg_notices_updated_at on public.notices;
create trigger trg_notices_updated_at
before update on public.notices
for each row execute function public.set_updated_at();

alter table public.notices enable row level security;

-- Everyone who is an active user (viewer/editor/admin) can READ.
drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices
  for select using (public.current_role_name() is not null);

-- INSERT: any active role that is in this page's allowed list can create.
-- (viewer = limited access = can read + insert, per the app-wide rule)
drop policy if exists notices_insert on public.notices;
create policy notices_insert on public.notices
  for insert with check (
    public.current_role_name() in ('admin','editor','viewer')
  );

-- UPDATE / DELETE: only "full access" roles for this page (admin, editor).
drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices
  for update using (
    public.current_role_name() in ('admin','editor')
  );

drop policy if exists notices_delete on public.notices;
create policy notices_delete on public.notices
  for delete using (
    public.current_role_name() in ('admin','editor')
  );
