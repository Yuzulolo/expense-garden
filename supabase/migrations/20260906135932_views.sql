-- §A.6 computed-on-read views
--
-- Growth and savings are DERIVED, never stored (requirement 5). Three
-- consequences worth stating, because they are why this migration is short:
--
--   * "Plants reset each month" (requirement 6) is free — the aggregate groups
--     by month, so a new month is simply an empty group. No reset job exists to
--     schedule, fail, or run twice.
--   * There is no second write path here, so there are no write policies to get
--     right and no way for a stored total to drift from the rows it summarises.
--   * A materialized view was rejected: REFRESH requires ownership (an elevated
--     role), and matviews do not respect RLS at all.
--
-- ============================================================================
-- WHY security_invoker = on IS LOAD-BEARING (§B.6)
--
-- A Postgres view executes with the privileges of its OWNER, not its caller.
-- Migrations run as a privileged role, so without this setting these views
-- would be owned by a role that is not subject to RLS on public.expenses —
-- and would happily return EVERY user's financial totals to anyone who can
-- select from them.
--
-- The failure is invisible in development: with one account, "all rows" and
-- "my rows" are the same set, and the dashboard looks perfect.
--
-- With security_invoker = on the view runs as the caller, so the base table's
-- RLS policies apply inside it and each user sees only their own aggregate.
-- Views cannot carry RLS policies of their own — this setting plus RLS on the
-- base table is the entire protection. There is no second mechanism.
-- ============================================================================

-- Per-user, per-month, per-category expense totals. This is what the garden
-- reads: one row per plant per month, ~12 rows for a dashboard render, served
-- by expenses_user_cat_date_idx.
create view public.v_category_month_totals
with (security_invoker = on) as
select
  e.user_id,
  date_trunc('month', e.occurred_on)::date as month,
  e.category_slug,
  sum(e.amount_cents)::bigint              as total_cents,
  count(*)::int                            as entry_count
from public.expenses e
group by 1, 2, 3;

-- Monthly expense rollup, for the savings figure (total income − total
-- expenses). Kept separate from the per-category view rather than summing it in
-- the app, so the monthly number has one definition in one place.
create view public.v_month_expense_totals
with (security_invoker = on) as
select
  e.user_id,
  date_trunc('month', e.occurred_on)::date as month,
  sum(e.amount_cents)::bigint              as total_cents,
  count(*)::int                            as entry_count
from public.expenses e
group by 1, 2;

-- Monthly income rollup — the other half of the savings figure.
create view public.v_month_income_totals
with (security_invoker = on) as
select
  i.user_id,
  date_trunc('month', i.occurred_on)::date as month,
  sum(i.amount_cents)::bigint              as total_cents,
  count(*)::int                            as entry_count
from public.incomes i
group by 1, 2;

-- Privileges, matching every other object in this schema: anon has no business
-- here at all, and signed-in users get read-only access. Note that GROUP BY does
-- not anonymize anything — these views are keyed by user_id, so a leaking view
-- hands out a pre-summarised financial profile per user, which is arguably
-- worse than leaking the raw rows.
revoke all on public.v_category_month_totals from anon, authenticated;
revoke all on public.v_month_expense_totals  from anon, authenticated;
revoke all on public.v_month_income_totals   from anon, authenticated;

grant select on public.v_category_month_totals to authenticated;
grant select on public.v_month_expense_totals  to authenticated;
grant select on public.v_month_income_totals   to authenticated;
