-- =============================================================================
-- Cross-user privacy test for public.messages (the AI conversation history)
--
-- Sprint 3 bonus criterion: "a test confirming that one user's AI context cannot
-- be reached by a second user."
--
-- Companion to supabase/tests/rls.sql, which covers expenses / views /
-- monthly_closes. Same savepoint-wrapped pattern as that file's Part 2: each
-- write sits in its own savepoint, so every statement is evaluated on its own
-- merits instead of the first error aborting the transaction and turning the
-- rest into "current transaction is aborted" — a shape that cannot tell a real
-- failure from a skipped one, and so fails open.
--
-- Run in the Supabase SQL editor (or `psql`) — see the "HOW TO RUN" block below.
--
-- SAFE TO RUN AGAINST THE LIVE PROJECT. Part 1 is one transaction that ends in
-- `rollback`: the two seed rows it writes are discarded along with everything
-- else. Part 2 is read-only catalog queries.
--
-- USER IDS ARE ALREADY SUBSTITUTED (A is the victim, B is the attacker) —
-- verify against your project with:
--   select id, email from auth.users order by created_at;
--   A (victim)   d5ccc7bf-3ced-48fb-9550-bfb2de3edf7f  xiangquyuanfang@hotmail.com
--   B (attacker) a145738e-9f41-4757-832f-933018f28629  xiangquyuanfang@gmail.com
--
-- -----------------------------------------------------------------------------
-- WHY THIS SEEDS ITS OWN DATA
--
-- "B sees none of A's messages" is only a real assertion if A has messages to
-- see. On an empty table, or a project where A has never used chat, the read
-- check passes for the wrong reason. So Part 1 first inserts two rows as A —
-- inside the same transaction, before the first savepoint, so B's reads can see
-- them if RLS lets them through and the failing writes below cannot roll them
-- back. The seed also exercises the `user_id default auth.uid()` path: A never
-- names its own id.
--
-- The role/claims switch mid-transaction is what makes one transaction enough:
-- `set_config('request.jwt.claims', ..., true)` is the same mechanism as the
-- `set local` in rls.sql, just callable as a statement so it can be repeated
-- after a `rollback to savepoint` discards it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- HOW TO RUN
--
--   Hosted project, dashboard:
--     1. select id, email from auth.users order by created_at;   -- confirm A and B
--     2. Paste Part 1 into the SQL editor and run it as one script.
--     3. Paste Part 2 and run it.
--
--   Hosted project, psql:
--     psql "$DATABASE_URL" -f supabase/tests/rls_messages.sql
--
--   Local stack:
--     npx supabase start && npx supabase db reset
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--       -f supabase/tests/rls_messages.sql
--
--   In psql, add `-v ON_ERROR_STOP=off` only if your psqlrc turns it on: the
--   three expected 42501 errors are the point of the test, not a reason to stop.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- WHAT PASSING LOOKS LIKE
--
-- Part 1, in order:
--   INSERT 0 2                                  -- A's two seeded messages
--   INSERT 0 1                                  -- B's one message
--   1a  leaked_rows = 0, own_rows = 1, visible_rows = 1, verdict = PASS
--       distinct user_id -> exactly one row, B's uuid
--       a_rows_reachable = 0
--   1b  ERROR: new row violates row-level security policy for table "messages"
--   1c  ERROR: permission denied for table messages
--   1d  ERROR: permission denied for table messages
--   1e  ERROR: permission denied for table messages   (x2: update, then delete)
--   ROLLBACK
--
-- Part 2:
--   2a  rls_enabled = t, policy_count = 2, select_policies = 1,
--       insert_policies = 1, mutating_policies = 0, verdict = PASS
--   2b  exactly two rows: messages_insert_own / INSERT / {authenticated}
--                         messages_select_own / SELECT / {authenticated}
--   2c  exactly two rows: INSERT, SELECT (both for authenticated; none for anon)
--
-- Every one of the four ERRORs is SQLSTATE 42501 (insufficient_privilege). psql
-- prints the message, not the code; `\set VERBOSITY verbose` shows the code if
-- you want it on screen. In the dashboard SQL editor each ERROR appears as a
-- red result for that statement while the surrounding statements still report
-- their own outcome — that is the savepoint wrapping working.
--
-- FAILING looks like: any verdict = FAIL; leaked_rows > 0; a_rows_reachable > 0;
-- any of 1b-1e reporting `INSERT 0 1` / `UPDATE n` / `DELETE n` instead of an
-- error; or "current transaction is aborted" anywhere, which means a savepoint
-- is missing and the statements after it were never evaluated.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- Part 1 — two-account behaviour test
-- =============================================================================

begin;

set local role authenticated;

-- --- Seed: two messages belonging to A -----------------------------------------
-- user_id is NOT supplied: it comes from `default auth.uid()`, i.e. from the
-- claims, which is the same path the app takes.
select set_config('request.jwt.claims',
                  '{"sub":"d5ccc7bf-3ced-48fb-9550-bfb2de3edf7f","role":"authenticated"}', true);

insert into public.messages (role, content) values
  ('user',      'how much did I spend on social last month?'),
  ('assistant', 'You spent $124.00 on social in August 2026.');
-- Expect: INSERT 0 2. If this errors, A's uuid is wrong or claims are unset.


-- --- Switch to B, the second user ---------------------------------------------
select set_config('request.jwt.claims',
                  '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}', true);

insert into public.messages (role, content) values
  ('user', 'what is my biggest category this year?');
-- Expect: INSERT 0 1. Gives B a row of its own, so the read checks below
-- distinguish "RLS filters to B" from "B sees nothing at all".


-- --- 1a. Read: B sees only B ---------------------------------------------------
-- The whole criterion in one row. leaked_rows must be 0 and own_rows must be 1.
select count(*) filter (where user_id <> 'a145738e-9f41-4757-832f-933018f28629')  as leaked_rows,
       count(*) filter (where user_id =  'a145738e-9f41-4757-832f-933018f28629')  as own_rows,
       count(*)                                            as visible_rows,
       case when count(*) filter (where user_id <> 'a145738e-9f41-4757-832f-933018f28629') = 0
             and count(*) filter (where user_id =  'a145738e-9f41-4757-832f-933018f28629') > 0
            then 'PASS' else 'FAIL' end                    as verdict
  from public.messages;

-- Same thing said a second way: the id list B can reach must be exactly {B}.
select distinct user_id from public.messages;
-- Expect: exactly one row, B's uuid.

-- And A's seeded content specifically must be unreachable, including by a
-- targeted lookup that names A outright.
select count(*) as a_rows_reachable
  from public.messages
 where user_id = 'd5ccc7bf-3ced-48fb-9550-bfb2de3edf7f';
-- Expect: 0. The select policy ANDs `auth.uid() = user_id` in, so naming A in a
-- WHERE clause narrows the result rather than widening it.


-- --- 1b. Forging ownership on insert ------------------------------------------
-- Writing into A's conversation. Expect ERROR 42501:
--   new row violates row-level security policy for table "messages"
savepoint s1b;
insert into public.messages (user_id, role, content)
  values ('d5ccc7bf-3ced-48fb-9550-bfb2de3edf7f', 'user', 'injected into A''s transcript');
rollback to savepoint s1b;


-- --- 1c. Updating one of A's messages -----------------------------------------
-- Expect ERROR 42501: permission denied for table messages
--
-- Note WHICH error this is, because it is stronger than the alternative. The
-- table has no UPDATE policy at all, and the migration also revokes the UPDATE
-- privilege. The privilege check runs BEFORE RLS, so the statement is rejected
-- outright rather than matching zero rows — B cannot even attempt the write.
-- (Contrast rls.sql case 2d, where the privilege exists and the policy is what
-- reduces the statement to "UPDATE 0".)
savepoint s1c;
select set_config('request.jwt.claims',
                  '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}', true);
update public.messages
   set content = 'rewritten'
 where user_id = 'd5ccc7bf-3ced-48fb-9550-bfb2de3edf7f';
rollback to savepoint s1c;


-- --- 1d. Deleting one of A's messages -----------------------------------------
-- Expect ERROR 42501: permission denied for table messages — same reason as 1c.
savepoint s1d;
select set_config('request.jwt.claims',
                  '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}', true);
delete from public.messages where user_id = 'd5ccc7bf-3ced-48fb-9550-bfb2de3edf7f';
rollback to savepoint s1d;


-- --- 1e. Append-only holds for B's OWN messages too ---------------------------
-- Not a cross-user case, but it is what makes 1c and 1d unambiguous: the denial
-- there is not "these rows aren't yours", it is "this table is not writable that
-- way". Expect ERROR 42501: permission denied for table messages.
savepoint s1e;
select set_config('request.jwt.claims',
                  '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}', true);
update public.messages set content = 'rewritten' where user_id = 'a145738e-9f41-4757-832f-933018f28629';
rollback to savepoint s1e;

savepoint s1f;
select set_config('request.jwt.claims',
                  '{"sub":"a145738e-9f41-4757-832f-933018f28629","role":"authenticated"}', true);
delete from public.messages where user_id = 'a145738e-9f41-4757-832f-933018f28629';
rollback to savepoint s1f;


-- Nothing above persists.
rollback;


-- =============================================================================
-- Part 2 — catalog check: RLS on, and exactly the two expected policies
--
-- Read-only. Run as the default (owner) role — these are catalog reads, not a
-- test of what `authenticated` can see.
-- =============================================================================

-- 2a. One-row verdict.
select
  (select rowsecurity
     from pg_tables
    where schemaname = 'public' and tablename = 'messages')      as rls_enabled,
  count(*)                                                       as policy_count,
  count(*) filter (where cmd = 'SELECT')                         as select_policies,
  count(*) filter (where cmd = 'INSERT')                         as insert_policies,
  count(*) filter (where cmd in ('UPDATE', 'DELETE', 'ALL'))     as mutating_policies,
  case when (select rowsecurity from pg_tables
              where schemaname = 'public' and tablename = 'messages')
        and count(*) = 2
        and count(*) filter (where cmd = 'SELECT') = 1
        and count(*) filter (where cmd = 'INSERT') = 1
        and count(*) filter (where cmd in ('UPDATE', 'DELETE', 'ALL')) = 0
       then 'PASS' else 'FAIL' end                               as verdict
  from pg_policies
 where schemaname = 'public' and tablename = 'messages';
-- Expect: rls_enabled = t, policy_count = 2, select_policies = 1,
--         insert_policies = 1, mutating_policies = 0, verdict = PASS.

-- 2b. The same two policies spelled out, so a rename or a widened role is
--     visible rather than merely counted.
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'messages'
 order by cmd, policyname;
-- Expect exactly two rows:
--   messages_insert_own | INSERT | {authenticated} | (null)                     | (( SELECT auth.uid() AS uid) = user_id)
--   messages_select_own | SELECT | {authenticated} | (( SELECT auth.uid()...))  | (null)
-- `roles` must be {authenticated} on both — {public} would extend the policy to
-- the anon key.

-- 2c. Privileges, which are the other half of 1c/1d. The grant is what makes
--     UPDATE/DELETE fail before RLS is consulted.
select privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'messages'
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;
-- Expect exactly two rows, both for authenticated: INSERT and SELECT.
-- No UPDATE, no DELETE, and nothing at all for anon.
