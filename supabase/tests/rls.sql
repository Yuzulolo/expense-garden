-- =============================================================================
-- §D.12 — the two-account RLS test
--
-- Verbatim from docs/ARCHITECTURE.md §D.12, plus the two catalog queries from
-- §B.6 that §D.12 calls for. Run in the Supabase SQL editor.
--
-- PREREQUISITES — this file tests the FINISHED schema. As of now only
-- migrations for `profiles` and `categories` exist, so Part 1 and the
-- `savings_overrides` / `monthly_closes` / `expenses` statements below will
-- error with "relation does not exist" until migrations 0003-0007 are applied
-- (expenses, incomes, savings, views, seal). Part 3's catalog queries run today.
--
-- USER IDS ARE ALREADY SUBSTITUTED (verify against your project):
--   select id, email from auth.users order by created_at;
--   A (victim)   d5ccc7bf-3ced-48fb-9550-bfb2de3edf7f  xiangquyuanfang@hotmail.com
--   B (attacker) a145738e-9f41-4757-832f-933018f28629  xiangquyuanfang@gmail.com
--
-- SEE ALSO: supabase/tests/rls_messages.sql — the same two-account test for
-- public.messages (the AI conversation history), added in Sprint 3. It is a
-- separate file because it seeds its own rows and so does not share this file's
-- "substitute two ids into the finished schema" prerequisites.
--
-- -----------------------------------------------------------------------------
-- WHY THERE ARE TWO VERSIONS OF THE SAME TEST
--
-- Part 1 is §D.12 exactly as the proposal specifies it, kept so the file matches
-- the reviewed document.
--
-- Part 2 is the version to actually judge results by. In Part 1 all four write
-- statements share one transaction, so the first one that raises aborts the
-- transaction and the rest return "current transaction is aborted" instead of
-- their own errors — four failures on screen, three of them never evaluated.
-- A test that cannot tell those apart fails open. Part 2 wraps each write in its
-- own savepoint, so every statement is evaluated and reports its real outcome.
--
-- Part 2 also moves the fourth statement out of the "must FAIL" group. An UPDATE
-- against another user's rows matches nothing rather than raising, so its pass
-- condition is "succeeds, 0 rows" — the one case where an empty result is the
-- correct answer.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Part 1 — §D.12 as written (reference; see header before judging results)
-- -----------------------------------------------------------------------------

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}';

select count(*) from public.expenses;                  -- must equal B's count only
select * from public.v_category_month_totals;          -- must contain only B's user_id
select * from public.monthly_closes;                   -- only B's

-- these must all FAIL:
insert into public.expenses (user_id, category_slug, amount_cents, occurred_on)
  values ('d5ccc7bf-3ced-48fb-9550-bfb2de3edf7f', 'social', 100, '2026-09-01');       -- WITH CHECK violation
update public.monthly_closes set total_income_cents = 999999;   -- no policy / no privilege
delete from public.monthly_closes;                              -- no policy / no privilege
update public.savings_overrides set manual_net_cents = 1
  where user_id = 'd5ccc7bf-3ced-48fb-9550-bfb2de3edf7f';                              -- 0 rows affected
rollback;


-- -----------------------------------------------------------------------------
-- Part 2 — same test, each statement evaluated independently
--
-- Nothing here persists: every write is rolled back to its savepoint, and the
-- transaction ends in `rollback`. Safe to run against the live project.
-- -----------------------------------------------------------------------------

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}';
-- SET LOCAL is set before the first savepoint, so it survives every rollback-to.

-- Reads — B sees only B.
select count(*) from public.expenses;                  -- must equal B's count only
select * from public.v_category_month_totals;          -- must contain only B's user_id
select * from public.monthly_closes;                   -- only B's

-- 2a. Forging ownership on insert. Expect ERROR 42501:
--     new row violates row-level security policy for table "expenses"
savepoint s2a;
insert into public.expenses (user_id, category_slug, amount_cents, occurred_on)
  values ('d5ccc7bf-3ced-48fb-9550-bfb2de3edf7f', 'social', 100, '2026-09-01');
rollback to savepoint s2a;

-- 2b. Rewriting a sealed month. Expect ERROR 42501:
--     permission denied for table monthly_closes
--     (privilege check runs before RLS, so this is a grant error, not a policy
--     error — §B.4 revokes UPDATE outright rather than relying on an expression)
savepoint s2b;
update public.monthly_closes set total_income_cents = 999999;
rollback to savepoint s2b;

-- 2c. Delete-then-reinsert is also history rewriting. Expect ERROR 42501:
--     permission denied for table monthly_closes
savepoint s2c;
delete from public.monthly_closes;
rollback to savepoint s2c;

-- 2d. NOT a failure case. Expect success with UPDATE 0 — B's policy makes A's
--     rows invisible, so there is nothing to target. A non-zero count here is
--     the failure.
savepoint s2d;
update public.savings_overrides set manual_net_cents = 1
  where user_id = 'd5ccc7bf-3ced-48fb-9550-bfb2de3edf7f';
rollback to savepoint s2d;

rollback;


-- -----------------------------------------------------------------------------
-- Part 3 — catalog queries (§B.6). These run today.
-- -----------------------------------------------------------------------------

select c.relname, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public';
-- every row must show {security_invoker=on}

select tablename, rowsecurity from pg_tables where schemaname = 'public';
-- every row must show rowsecurity = true


-- -----------------------------------------------------------------------------
-- Part 4 — also required by §D.12, not expressible in SQL
-- -----------------------------------------------------------------------------
--
-- Two-account UI test: create user A with expenses across three categories and
-- an income; create user B in a different browser profile with different data.
-- Then, as B, visit /dashboard, /expenses, /months/2026-08, /review/2026.
-- Every page must show only B's data, and B must not be able to reach A's rows
-- by editing an id in a URL.
--
-- Plus a clean run of Supabase's Database Advisors (`npx supabase db advisors`,
-- CLI v2.81.3+, or Advisors in the dashboard): zero "RLS disabled in public"
-- and zero "security definer view" findings.
