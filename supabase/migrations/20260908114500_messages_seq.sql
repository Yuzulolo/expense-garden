-- A deterministic order for the chat transcript.
--
-- The problem: a question and its answer are written in ONE insert, so
-- `created_at default now()` — the transaction timestamp — is byte-identical for
-- both rows. `order by created_at desc` therefore has no defined order within a
-- pair, and Postgres is free to return the answer before its question. The chat
-- page groups turns into question/answer pairs in write order, so a flipped pair
-- renders an orphan answer followed by an unanswered question; the same rows are
-- replayed to the model as conversation history, where a flip changes what the
-- model is told was asked.
--
-- `id` is no help as a tiebreaker: it is a random uuid, so it imposes an
-- arbitrary order rather than the write order.
--
-- The fix is a monotonic column. `generated always as identity` rather than
-- `serial`: it is the SQL-standard form, and — unlike serial — an insert needs
-- no privilege on the underlying sequence, so the `authenticated` grants below
-- stay exactly as narrow as they were. `always` also means the column cannot be
-- supplied by a client, which suits an append-only table.
--
-- Locking: the ADD COLUMN and the backfill take ACCESS EXCLUSIVE on
-- public.messages. The table holds one conversation per user and is small, so
-- this is a brief lock rather than a migration that needs batching.

-- Added nullable first. Attaching the identity in the same statement would let
-- the rewrite assign values in physical order, which is not the write order and
-- would scramble the existing transcript.
alter table public.messages
  add column seq bigint;

-- Backfill in the intended reading order. Within a created_at tie the question
-- precedes its answer: `role = 'assistant'` sorts false-before-true, which also
-- repairs any pair that is already stored ambiguously. `id` last so the order is
-- total and the result is reproducible.
with ordered as (
  select id,
         row_number() over (
           order by created_at, (role = 'assistant'), id
         ) as rn
    from public.messages
)
update public.messages m
   set seq = o.rn
  from ordered o
 where o.id = m.id;

alter table public.messages
  alter column seq set not null,
  alter column seq add generated always as identity;

-- The identity sequence starts at 1, which the backfill has already used. Move
-- it past the highest existing value. `is_called => false` so the next insert
-- gets exactly this number rather than the one after it.
select setval(
  pg_get_serial_sequence('public.messages', 'seq'),
  coalesce((select max(seq) from public.messages), 0) + 1,
  false
);

-- Ordering is by seq now, so the index that serves it changes with it. user_id
-- still leads: RLS ANDs `user_id = auth.uid()` into every read, and the equality
-- column belongs before the range/ordering column.
drop index if exists public.messages_user_created_idx;

create index messages_user_seq_idx
  on public.messages (user_id, seq desc);

-- No new grants. seq is `generated always as identity`, so `grant insert` alone
-- is sufficient to write a row and the column cannot be set by a client.
