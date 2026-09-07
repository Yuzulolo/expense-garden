-- §A.4 incomes + §B.1 owner-scoped policies (identical shape to expenses)
--
-- Reuses public.touch_updated_at(), created in migration 20260904154520.

create table public.incomes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  source       text not null check (char_length(source) between 1 and 80),
  description  text check (char_length(description) <= 280),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  occurred_on  date not null check (occurred_on >= date '2000-01-01'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Same fixed lower bound as expenses, and for the same reason: current_date is
-- STABLE, so a `<= current_date` CHECK would invalidate stored rows over time
-- and can break pg_dump/restore. Income dates feed the same monthly savings
-- calculation, so a stray year-9999 row would distort savings, not just a plant.

-- `source` is deliberately free text, not a lookup table: unlike expense
-- categories the requirements don't fix the set, and there's no plant to render.
-- The length CHECK is the whole validation surface it needs.

-- user_id leads the index, for the same RLS reason as expenses. Only one index
-- here — there is no category dimension to slice income by.
create index incomes_user_date_idx on public.incomes (user_id, occurred_on);

alter table public.incomes enable row level security;

create policy "incomes_select_own"
  on public.incomes
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "incomes_insert_own"
  on public.incomes
  for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "incomes_update_own"
  on public.incomes
  for update
  to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "incomes_delete_own"
  on public.incomes
  for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

revoke all on table public.incomes from anon, authenticated;
grant select, insert, update, delete on table public.incomes to authenticated;

-- updated_at maintenance, using the shared function from the expenses migration.
create trigger incomes_touch_updated_at
  before update on public.incomes
  for each row execute function public.touch_updated_at();
