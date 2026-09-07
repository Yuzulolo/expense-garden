-- §A.5 the savings record — split by trust, not by entity
--
-- The savings feature mixes two kinds of data with opposite trust levels:
-- numbers the server DERIVES from the user's transactions (must be unforgeable)
-- and a number the user TYPES to override it (must be freely editable).
--
-- One table would put both behind a single column grant, and the only thing
-- standing between "user edits their note" and "user rewrites their sealed
-- financial history" would be that grant being written correctly. So: two
-- tables, with opposite privileges.

-- ============================================================================
-- A.5.2  monthly_closes — the black box. Created first: the trigger at the
--        bottom of this file reads it.
-- ============================================================================

create table public.monthly_closes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  month               date not null check (month = date_trunc('month', month)::date),

  -- frozen snapshot, computed server-side at seal time
  total_income_cents  bigint not null check (total_income_cents  >= 0),
  total_expense_cents bigint not null check (total_expense_cents >= 0),
  manual_net_cents    bigint,                              -- NULL = no override at seal time
  category_totals     jsonb not null default '{}'::jsonb,  -- {"social": 12300}

  -- Derived, cannot drift, cannot be written by anyone.
  -- A generated column may not reference another generated column, which is why
  -- effective_net_cents recomputes the subtraction instead of reusing
  -- calculated_net_cents. Both reference only plain columns — that is legal.
  calculated_net_cents bigint generated always as
    (total_income_cents - total_expense_cents) stored,
  effective_net_cents  bigint generated always as
    (coalesce(manual_net_cents, total_income_cents - total_expense_cents)) stored,
  amount_source        text generated always as
    (case when manual_net_cents is null then 'calculated' else 'manual' end) stored,

  closed_at timestamptz not null default now(),
  unique (user_id, month)
);

create index monthly_closes_user_month_idx
  on public.monthly_closes (user_id, month desc);

alter table public.monthly_closes enable row level security;

-- §B.4. Read your own closes. That is the entire client-facing surface.
create policy "mc_select_own"
  on public.monthly_closes
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- NO insert policy. NO update policy. NO delete policy. Ever.
--
-- Immutability by ABSENCE of policy, not by clever policy. The tempting
-- alternative — `for update using (... and closed_at is null)` — works, but it
-- is an expression that has to be reasoned about, and one added `or` for some
-- UI convenience silently ends the guarantee. Zero write policies has no
-- expression to audit.
--
-- Three things a "locked" flag in the UI would not cover, and this does:
--   * blocking UPDATE without blocking DELETE is not immutability —
--     delete-then-reinsert rewrites history just as effectively;
--   * blocking writes without blocking INSERT is worse than nothing — a user
--     could fabricate a sealed record before the real seal runs, and
--     unique (user_id, month) would then protect the forgery;
--   * a disabled button is one PATCH to /rest/v1/monthly_closes away from
--     being bypassed, using the publishable key printed in our own bundle.
revoke all on table public.monthly_closes from anon, authenticated;
grant select on table public.monthly_closes to authenticated;

-- Stated again explicitly, as §B.4 requires, so the intent survives a future
-- edit that adds a broader grant above.
revoke insert, update, delete on table public.monthly_closes from anon, authenticated;

-- ============================================================================
-- A.5.1  savings_overrides — 100% user-owned, zero server-derived columns
-- ============================================================================

create table public.savings_overrides (
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  month            date not null check (month = date_trunc('month', month)::date),
  manual_net_cents bigint not null
                     check (manual_net_cents between -100000000000 and 100000000000),
  note             text check (char_length(note) <= 280),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, month)
);

-- The month check prevents '2026-09-17' sneaking in and creating a second
-- "September" row alongside '2026-09-01'.
--
-- Note what is NOT here: no calculated total, no income, no expense figure.
-- Nothing in this row is authoritative about anything except what the user
-- claims. That is what makes full user CRUD safe — there is no server-computed
-- column in the row for an UPDATE to overwrite.
--
-- Deleting the row IS "revert to calculated". No separate flag, no ambiguity.

alter table public.savings_overrides enable row level security;

create policy "so_select_own"
  on public.savings_overrides
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "so_insert_own"
  on public.savings_overrides
  for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "so_update_own"
  on public.savings_overrides
  for update
  to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "so_delete_own"
  on public.savings_overrides
  for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

revoke all on table public.savings_overrides from anon, authenticated;
grant select, insert, update, delete on table public.savings_overrides to authenticated;

create trigger savings_overrides_touch_updated_at
  before update on public.savings_overrides
  for each row execute function public.touch_updated_at();

-- §B.3 the lock guard.
--
-- RLS cannot easily express "no row exists in another table", so this is a
-- trigger. Deliberately SECURITY INVOKER (the default): it runs as the user, so
-- its select on monthly_closes is filtered by that user's own SELECT policy —
-- which is all it needs to see. Do not "fix" it by adding security definer.
--
-- set search_path = '' only to keep the database linter clean; every reference
-- below is already schema-qualified.
create or replace function public.reject_override_on_closed_month()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.monthly_closes c
    where c.user_id = new.user_id and c.month = new.month
  ) then
    raise exception 'Month % is already closed and cannot be corrected', new.month
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger so_no_closed_months
  before insert or update on public.savings_overrides
  for each row execute function public.reject_override_on_closed_month();
