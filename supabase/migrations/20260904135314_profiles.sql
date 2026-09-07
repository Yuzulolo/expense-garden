-- §A.1 profiles + §B.5 new-user bootstrap
--
-- One row per auth user. `timezone` exists for exactly one reason: deciding which
-- month is "now" on the server (features 6, 8, 9). Never ask the browser.
-- `on delete cascade` means deleting an account really deletes the financial data.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 60),
  timezone     text not null default 'UTC',   -- IANA, e.g. 'Europe/Vilnius'
  created_at   timestamptz not null default now()
);

-- RLS in the same migration as the create table. Never a migration later.
alter table public.profiles enable row level security;

-- §B: every policy names the owning column and is scoped `to authenticated`, so
-- "logged out matches nothing" is structural rather than incidental.
-- `(select auth.uid())` is cached as an InitPlan and evaluated once per query.

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ( (select auth.uid()) = id );

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using      ( (select auth.uid()) = id )   -- which rows I may target
  with check ( (select auth.uid()) = id );  -- what the row may become

-- No INSERT policy: rows are created by the handle_new_user trigger below.
-- No DELETE policy: account deletion cascades from auth.users.

-- Explicit Data API grants. Bundled with RLS in the same migration, per current
-- Supabase guidance: the platform default for auto-granting new public tables to
-- anon/authenticated is moving to opt-in, so relying on it would make this
-- migration behave differently on a future project.
revoke all on table public.profiles from anon, authenticated;
grant select, update on table public.profiles to authenticated;

-- §B.5 profile bootstrap. SECURITY DEFINER by necessity: auth.users is not
-- writable by clients, so the insert cannot run as the signing-up user.
-- `set search_path = ''` + fully-qualified names: without it a definer function
-- resolves unqualified names through the caller's search_path, and a shadowing
-- object in an earlier schema would redirect this elevated write.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end $$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and anon/authenticated
-- inherit from PUBLIC — so a SECURITY DEFINER function in `public` is a callable
-- endpoint unless revoked. Mirrors the revoke §B.5 applies to seal_month.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
