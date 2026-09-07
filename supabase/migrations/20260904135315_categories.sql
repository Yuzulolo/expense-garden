-- §A.2 categories — the fixed plant set
--
-- Modeled as a lookup table rather than an enum or an app constant, because
-- PostgREST is a public API and the React form is not a gate: a forged
-- category_slug has to fail at the database. With an FK from expenses, it does.
--
-- is_active (rather than deleting a row) matters because deleting a category
-- would either cascade-delete a user's expenses or block the delete. Retiring
-- is the correct operation; historical rows stay valid.

create table public.categories (
  slug       text primary key check (slug ~ '^[a-z][a-z0-9_]{1,31}$'),
  label      text not null,
  plant_key  text not null,          -- which sprite/SVG set to render
  sort_order smallint not null,
  is_active  boolean not null default true
);

-- RLS in the same migration as the create table.
alter table public.categories enable row level security;

-- The seed IS the "fixed set". It runs here, as part of the migration, which
-- executes privileged and outside any client's reach.
insert into public.categories (slug, label, plant_key, sort_order) values
  ('social',    'Social',    'vine',      1),
  ('beauty',    'Beauty',    'orchid',    2),
  ('sports',    'Sports',    'bamboo',    3),
  ('food',      'Food',      'tomato',    4),
  ('transport', 'Transport', 'fern',      5),
  ('other',     'Other',     'succulent', 99);

-- §B.2 read-only reference data.
-- `using (true)` is correct here and only here: category names and plant sprites
-- are not private, and there is no user_id to scope by.
create policy "categories_select_all"
  on public.categories
  for select
  to authenticated
  using ( true );

-- No INSERT, UPDATE, or DELETE policy. Deliberately.
-- With RLS on and no write policy, every client write is denied by default —
-- there is no expression to get wrong. This is what "fixed set" means at the
-- database level.

-- Privileges match the policies: read for signed-in users, nothing for anon,
-- no write path for either. Explicit rather than inherited, for the same reason
-- as in the profiles migration.
revoke all on table public.categories from anon, authenticated;
grant select on table public.categories to authenticated;
