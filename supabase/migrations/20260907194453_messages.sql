-- Chat history for the spending-question feature.
--
-- Append-only by design: a conversation is a record of what was actually asked
-- and answered. There is no UPDATE or DELETE policy, so neither the user nor
-- the app can rewrite a past exchange — the same immutability argument as
-- monthly_closes, for the same reason (a history you can edit is not a history).

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

-- user_id leads the index: RLS ANDs `user_id = auth.uid()` into every query, and
-- the chat always reads the most recent messages first.
create index messages_user_created_idx
  on public.messages (user_id, created_at desc);

-- RLS in the same migration as the create table. Never a migration later.
alter table public.messages enable row level security;

-- `role` is a CHECK rather than an enum for the same reason expenses uses a
-- lookup table: the constraint has to hold at the database, because PostgREST
-- is reachable with the publishable key and never sees our TypeScript.

create policy "messages_select_own"
  on public.messages
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- INSERT has no USING clause, so this WITH CHECK is the entire insert
-- authorization. It names user_id, so a signed-in user cannot write a message
-- into someone else's conversation.
create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

-- No UPDATE policy. No DELETE policy. Deliberately — see the header.
-- Immutability by absence of policy: there is no expression to get wrong.

-- Privileges match the policies exactly. Explicit rather than inherited, for the
-- same reason as every other table here: the platform default for auto-granting
-- new public tables is moving to opt-in.
revoke all on table public.messages from anon, authenticated;
grant select, insert on table public.messages to authenticated;

-- Stated explicitly so the append-only intent survives a future edit that adds
-- a broader grant above.
revoke update, delete on table public.messages from anon, authenticated;
