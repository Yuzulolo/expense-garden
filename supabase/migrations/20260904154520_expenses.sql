-- §A.3 expenses + §B.1 owner-scoped policies
--
-- Depends on public.categories (migration 20260904135315) for the FK that makes
-- the "fixed set" of plant categories real at the database level.

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  category_slug text not null
                  references public.categories (slug) on update cascade,
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  description   text check (char_length(description) <= 280),
  occurred_on   date not null check (occurred_on >= date '2000-01-01'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The occurred_on bound is a FIXED date on purpose. `check (occurred_on <=
-- current_date)` would be the obvious way to block absurd future dates, but
-- current_date is STABLE, not immutable: the constraint is only evaluated at
-- write time, existing rows silently become "invalid" as the clock moves, and
-- pg_dump/restore can then fail. A far-future date poisons month grouping for
-- that user permanently, so the upper bound belongs in a BEFORE INSERT trigger
-- or the server action instead.

-- `default auth.uid()` means the client never sends a user_id at all, so forging
-- ownership has to beat this default AND the WITH CHECK policy below — two
-- independent mechanisms.
--
-- user_id leads both indexes: RLS silently ANDs `user_id = auth.uid()` into
-- every query, so an index that doesn't start with user_id won't be used well.
create index expenses_user_date_idx     on public.expenses (user_id, occurred_on);
create index expenses_user_cat_date_idx on public.expenses (user_id, category_slug, occurred_on);

-- RLS in the same migration as the create table. Never a migration later.
alter table public.expenses enable row level security;

-- §B.1. USING decides which existing rows you may see or target; WITH CHECK
-- decides what a row is allowed to look like after you write it. They answer
-- different questions, and both are written explicitly here.

create policy "expenses_select_own"
  on public.expenses
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- INSERT has no USING clause, so this WITH CHECK is the entire insert
-- authorization. `with check (true)` or `with check (auth.uid() is not null)`
-- here would let any signed-in person write rows owned by anyone.
create policy "expenses_insert_own"
  on public.expenses
  for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

-- Without the WITH CHECK, a user could move their own row to another user_id.
create policy "expenses_update_own"
  on public.expenses
  for update
  to authenticated
  using      ( (select auth.uid()) = user_id )   -- which rows I may target
  with check ( (select auth.uid()) = user_id );  -- what the row may become

create policy "expenses_delete_own"
  on public.expenses
  for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- Privileges match the policies. Explicit rather than inherited, for the same
-- reason as in the profiles and categories migrations: the platform default for
-- auto-granting new public tables is moving to opt-in.
revoke all on table public.expenses from anon, authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;

-- updated_at maintenance.
--
-- Declaring `updated_at default now()` does not keep it current — without this
-- trigger the column is a permanent duplicate of created_at that merely looks
-- like an audit field. In a trigger rather than the server action because
-- PostgREST is directly reachable with the anon key: a rule enforced only in
-- application code is unenforced for anyone using curl.
--
-- SECURITY INVOKER (the default) deliberately: it needs no privileges of its
-- own. `set search_path = ''` keeps Supabase's database linter clean; now() is
-- in pg_catalog, which is always resolvable.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();
