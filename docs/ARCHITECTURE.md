# Secured Expense Garden — Architecture Proposal

Next.js App Router + Supabase, multi-user, beginner-built, graded on security.

**One-line thesis:** every number the app displays about money is either *derived on read from the user's own rows* or *frozen in an append-only snapshot written by exactly one server-side function*. There is no mutable, client-writable, server-meaningful state anywhere. That single rule kills most of the ways this app could leak or corrupt data.

---

## 0. Decisions at a glance

| Decision | Recommendation | Why (short) |
|---|---|---|
| Fixed categories | **Lookup table** `categories`, seeded by migration, read-only via RLS | DB-enforced integrity (forged slug fails the FK) + room for plant art/order |
| Category totals / plant growth | **Computed on read** via a view with `security_invoker = on` | Requirement 5 forbids stored growth; monthly reset becomes a `WHERE` clause, not a job |
| Money | **Integer minor units** (`amount_cents bigint`) | Exact sums; survives JSON without `parseFloat` corruption |
| Dates | `date` column for the event, `date` (first-of-month) for months, `timestamptz` only for audit | Month boundaries become unambiguous; no timezone math in the hot path |
| "Calculated vs. manual, which is current" | **Nullable override column + `GENERATED ALWAYS AS STORED` effective/source columns** | Structurally impossible for the flag to disagree with the data |
| Black-box lock-in | **Separate `monthly_closes` table with no client write policies at all** | Immutability by *absence of policy* — nothing to get wrong in a `USING` clause |
| Who runs month-end | **Lazy on-read sealing via a `SECURITY DEFINER` RPC called by the signed-in user** | No cron, no Edge Function, **no `service_role` key anywhere in the project** |
| Auth boundary | **RLS in Postgres.** Middleware is UX only | Middleware has been CVE-bypassed; RLS cannot be routed around |

A note on the framework: verify App Router specifics (async `cookies()`, middleware/proxy file conventions, `@supabase/ssr` helper signatures) against the installed version's own docs before writing code — these have changed across recent Next.js majors and stale tutorials are the main source of broken auth-cookie handling.

---

## A. Database schema

All tables live in `public` (so PostgREST exposes them) and **every one gets `enable row level security` in the same migration as its `create table`**. Never a migration later.

### A.1 `profiles`

```sql
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 60),
  timezone     text not null default 'UTC',   -- IANA, e.g. 'Europe/Vilnius'
  created_at   timestamptz not null default now()
);
```

- `timezone` exists for exactly one reason: deciding *which month is "now"* on the server (features 6, 8, 9). Never ask the browser.
- Created by a trigger on `auth.users` (§B.5), not by the client.
- `on delete cascade` everywhere from `auth.users` means deleting an account really deletes the financial data.

### A.2 `categories` — the fixed plant set

```sql
create table public.categories (
  slug        text primary key check (slug ~ '^[a-z][a-z0-9_]{1,31}$'),
  label       text not null,
  plant_key   text not null,          -- which sprite/SVG set to render
  sort_order  smallint not null,
  is_active   boolean not null default true
);

insert into public.categories (slug, label, plant_key, sort_order) values
  ('social','Social','vine',1),
  ('beauty','Beauty','orchid',2),
  ('sports','Sports','bamboo',3),
  ('food','Food','tomato',4),
  ('transport','Transport','fern',5),
  ('other','Other','succulent',99);
```

#### Modeling the fixed set — the three options

| Option | Security | Flexibility | Verdict |
|---|---|---|---|
| **Postgres `enum`** | Strongest — a bad value is a type error, unforgeable | Poor. `alter type ... add value` is awkward in migrations, values can't be removed, and you **cannot attach plant art / sort order / active flag** to an enum. You end up with a parallel TS map anyway | Runner-up |
| **Lookup table + FK** ✅ | Strong — a forged `category_slug` violates the FK and the insert fails at the DB, regardless of what the client sends. RLS makes it read-only reference data | Good. Add a category with an `insert`; retire one with `is_active = false` without invalidating historical rows | **Recommended** |
| **App constant only** (`text` column, TS union) | **Weakest.** The column accepts any string. Anyone with the anon key can POST `category_slug: "'; drop--"` or `"admin"` straight to PostgREST, bypassing your React form entirely. Your "fixed set" is fiction | Highest | Reject |

The deciding argument for a beginner on a security-graded project: **PostgREST is a public API.** Your form is not a gate. The FK is.

`is_active` (rather than deleting a row) matters because deleting a category would either cascade-delete a user's expenses or block the delete — both bad. Retiring is the correct operation.

### A.3 `expenses`

```sql
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users(id) on delete cascade,
  category_slug text not null
                  references public.categories(slug) on update cascade,
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  description   text check (char_length(description) <= 280),
  occurred_on   date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index expenses_user_date_idx     on public.expenses (user_id, occurred_on);
create index expenses_user_cat_date_idx on public.expenses (user_id, category_slug, occurred_on);
```

Two details that are doing real work:

- **`default auth.uid()` on `user_id`.** The client never sends a `user_id` at all. Combined with the `WITH CHECK` policy in §B, forging ownership requires beating two independent mechanisms.
- **`user_id` is the leading column of every index.** RLS silently ANDs `user_id = auth.uid()` into every query, so an index that doesn't start with `user_id` will not be used well. This is the single most common "Supabase got slow" cause.

**Constraint gotcha to know now:** `CHECK` constraints should only use *immutable* expressions. Postgres will let you write `check (occurred_on <= current_date)` but `current_date` is `STABLE`, so the constraint is only evaluated at write time and existing rows silently become "invalid" — and `pg_dump`/restore can then fail. Enforce "no absurd future dates" in a `BEFORE INSERT` trigger or the server action; keep `CHECK` to fixed bounds like `occurred_on >= date '2000-01-01'`.

### A.4 `incomes`

```sql
create table public.incomes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users(id) on delete cascade,
  source       text not null check (char_length(source) between 1 and 80),
  description  text check (char_length(description) <= 280),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  occurred_on  date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index incomes_user_date_idx on public.incomes (user_id, occurred_on);
```

Income `source` is deliberately **free text, not a lookup table** — unlike expense categories, the requirements don't fix the set, and there's no plant to render. Don't over-model it.

### A.5 The savings record — split by trust, not by entity

This is the design decision I'd defend hardest. The savings feature mixes two kinds of data with opposite trust levels:

- numbers the **server derives** from the user's transactions (must be unforgeable)
- a number the **user types** to override it (must be freely editable)

Putting both in one row means the *only* thing standing between "user edits their note" and "user rewrites their sealed financial history" is a correctly-written column grant. Beginners get column grants wrong. So: **two tables.**

#### A.5.1 `savings_overrides` — 100% user-owned, zero server-derived columns

```sql
create table public.savings_overrides (
  user_id          uuid not null default auth.uid()
                     references auth.users(id) on delete cascade,
  month            date not null check (month = date_trunc('month', month)::date),
  manual_net_cents bigint not null check (manual_net_cents between -100000000000 and 100000000000),
  note             text check (char_length(note) <= 280),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, month)
);
```

Full user CRUD. Nothing here is authoritative about anything except "what the user claims". Deleting the row *is* "revert to calculated" — no separate flag, no ambiguity. The `check (month = date_trunc('month', month))` prevents `month = '2026-09-17'` sneaking in and creating two "September" rows.

#### A.5.2 `monthly_closes` — the black box, written only by the sealing function

```sql
create table public.monthly_closes (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  month                  date not null check (month = date_trunc('month', month)::date),

  -- frozen snapshot, computed server-side at seal time
  total_income_cents     bigint not null check (total_income_cents  >= 0),
  total_expense_cents    bigint not null check (total_expense_cents >= 0),
  manual_net_cents       bigint,                       -- NULL = user had no override at seal time
  category_totals        jsonb  not null default '{}'::jsonb,  -- {"social": 12300, "sports": 4500}

  -- derived, cannot drift, cannot be written by anyone
  calculated_net_cents bigint generated always as
    (total_income_cents - total_expense_cents) stored,
  effective_net_cents  bigint generated always as
    (coalesce(manual_net_cents, total_income_cents - total_expense_cents)) stored,
  amount_source        text   generated always as
    (case when manual_net_cents is null then 'calculated' else 'manual' end) stored,

  closed_at timestamptz not null default now(),
  unique (user_id, month)
);

create index monthly_closes_user_month_idx on public.monthly_closes (user_id, month desc);
```

**Why the snapshot stores components, not just the net:** a black box that can't be re-explained isn't reviewable (requirement 9). Storing income, expense, and per-category totals means a closed month renders identically forever, even after the user edits or deletes 2024 transactions.

**Generated-column gotcha you will hit:** a generated column **cannot reference another generated column**. So `effective_net_cents` must recompute `total_income_cents - total_expense_cents` rather than reference `calculated_net_cents`. Both generated columns reference only plain columns — that's legal and that's why it's written this way.

Also: generated columns are not insertable. If the client tries to send `effective_net_cents`, PostgREST errors. That's a feature.

#### "Which one is current" — the three representations

| Representation | Failure mode | Verdict |
|---|---|---|
| **Explicit enum** `source text check (source in ('calculated','manual'))`, plain column | A **third** source of truth. Nothing stops `source='manual', manual_net_cents=NULL` or `source='calculated'` with an override sitting right there. Beginners forget to update it in one of the four write paths. Then the yearly review disagrees with the month view and you spend a night debugging | Reject |
| **Nullable override alone**, resolved in TypeScript | Correct, but the resolution rule (`??`) is duplicated in the dashboard, the month view, the yearly review, and the seal function. Four chances to write `||` instead of `??` and have a legitimate `0` override silently ignored | Acceptable, not best |
| **Nullable override + generated `effective` and `source` columns** ✅ | Drift is *structurally impossible* — the flag is a function of the data, computed by Postgres, unwritable by anyone. One resolution rule, in one place, enforced. Also gives you correct `0` handling for free | **Recommended** |

For the **open (unsealed) month**, there is no `monthly_closes` row yet, and there shouldn't be — the calculated value is live. The same four-field shape is presented by the view in §A.6, so the UI renders open and closed months through one identical contract.

**Post-lock corrections.** Recommendation for v1: **the sealed row is completely immutable, and the override for a sealed month is refused** (§B.4). This is the safest default and the easiest to explain to a grader. Designed-in v2 escape hatch, if the course wants correctability after lock:

```sql
create table public.close_adjustments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  close_id      uuid not null references public.monthly_closes(id) on delete cascade,
  delta_cents   bigint not null check (delta_cents <> 0),
  reason        text not null check (char_length(reason) between 3 and 280),
  created_at    timestamptz not null default now()
);
```
Insert-only (no UPDATE or DELETE policy at all). The corrected value is `effective_net_cents + sum(delta_cents)`. History is preserved rather than overwritten — which is the whole point of an audit trail.

### A.6 Computed-on-read views

**Recommendation: compute on read. Do not materialize.** Reasons, in order:

1. Requirement 5 explicitly forbids growth as stored mutable state — a materialized total *is* that state wearing a hat.
2. A materialized total is a second write path, and every write path needs its own RLS policy, its own validation, and its own correctness proof.
3. Requirement 6 ("plants reset each month") becomes **free**: the aggregate is grouped by month, so a new month is simply an empty group. No reset job to schedule, fail, or run twice.
4. Scale is trivially small. A single user's year of expenses is hundreds of rows; the index in §A.3 turns each dashboard query into one index range scan.

```sql
create view public.v_category_month_totals
with (security_invoker = on) as
select
  e.user_id,
  date_trunc('month', e.occurred_on)::date as month,
  e.category_slug,
  sum(e.amount_cents)::bigint as total_cents,
  count(*)::int               as entry_count
from public.expenses e
group by 1, 2, 3;

create view public.v_month_savings
with (security_invoker = on) as
select
  p.id as user_id,
  m.month,
  coalesce(i.total, 0)::bigint as total_income_cents,
  coalesce(x.total, 0)::bigint as total_expense_cents,
  (coalesce(i.total,0) - coalesce(x.total,0))::bigint as calculated_net_cents,
  o.manual_net_cents,
  coalesce(o.manual_net_cents, coalesce(i.total,0) - coalesce(x.total,0))::bigint
    as effective_net_cents,
  case when o.manual_net_cents is null then 'calculated' else 'manual' end as amount_source,
  (c.id is not null) as is_locked
from ... -- months generated per user, left-joined to income/expense sums,
         -- savings_overrides o, and monthly_closes c
```

Growth level is **not** in the database. It's a pure TypeScript function in `lib/growth.ts`:

```ts
export const growthStage = (totalCents: number, targetCents: number) =>
  Math.min(5, Math.floor((totalCents / targetCents) * 5)); // 0..5
```

Presentation logic belongs in presentation code. It has no security surface there.

**Rejected alternative — client-side aggregation.** Fetching every expense to the browser and summing in JS "works" and is even RLS-safe, but it puts the user's entire transaction history on the wire to render six plants, and it trains the habit of "filter in the client", which *is* how RLS mistakes become exploitable. Aggregate in Postgres.

**Rejected alternative — materialized view.** `REFRESH MATERIALIZED VIEW` requires ownership, i.e. an elevated role, i.e. reintroducing the exact privilege you're trying to avoid. And matviews do not respect RLS. If you ever genuinely need it, it goes in a private schema, refreshed by a `SECURITY DEFINER` function, never exposed directly.

### A.7 Money representation

| | Integer minor units ✅ | `numeric(14,2)` |
|---|---|---|
| Arithmetic in Postgres | Exact | Exact |
| Over the wire to JS | Plain JSON number, exact to 2^53 (≈ $90 trillion in cents) | PostgREST/pg return `numeric` as a **string** to avoid precision loss. Beginner writes `parseFloat(row.amount)`, then `a + b`, and now `0.1 + 0.2` bugs are in the savings total |
| Validation | `z.number().int().positive()` — trivially airtight | Needs decimal-string parsing and scale checks |
| Cost | One `formatMoney(cents)` helper and a `centsFromInput()` parser | "Feels" easier, isn't |

**Recommended: `bigint` cents.** Write `lib/money.ts` on day one with exactly two functions (`toCents(userInput: string)`, `formatCents(n: number)`), and never touch a raw cents value in JSX. `bigint` not `integer` because `integer` caps at ~$21M in cents and someone will enter a joke value during your demo.

### A.8 Dates, month boundaries, timezones

| Concern | Rule |
|---|---|
| When an expense happened | `occurred_on date`. An expense date is a **calendar fact**, not an instant. `timestamptz` here creates a month-boundary bug where a Sept 1 expense lands in August for some viewers |
| Identifying a month | `date` pinned to the 1st (`2026-09-01`), with `check (month = date_trunc('month', month)::date)`. **Not** `text '2026-09'` — text months sort wrong across year boundaries, can't be range-queried, and can't be indexed usefully |
| Audit timestamps | `timestamptz` (`created_at`, `updated_at`, `closed_at`). This is the only place instants belong |
| "What month is it *now*" | The **only** timezone-sensitive computation. Compute server-side: `date_trunc('month', (now() at time zone p.timezone))::date`. Never `new Date().getMonth()` in the browser — a user in UTC+13 would seal months a day early |
| Querying a month | `occurred_on >= '2026-09-01' and occurred_on < '2026-10-01'`. **Not** `date_trunc('month', occurred_on) = '2026-09-01'` — the function call defeats the plain btree index |

Put `startOfMonth`, `nextMonth`, `monthKey`, and `monthsBetween` in one `lib/month.ts` and import it everywhere. Every duplicated date calculation is a future off-by-one-month bug in a *financial* record.

---

## B. Row Level Security

### B.0 Before any policy: the mental model

Supabase grants the `anon` and `authenticated` roles broad table privileges on the `public` schema by default. **RLS is the only thing between a table in `public` and the whole internet**, because the anon key is in your JavaScript bundle by design. A table in `public` with RLS never enabled is a public API endpoint with no auth.

`auth.uid()` reads the `sub` claim from the verified JWT that PostgREST puts in a per-request session setting. It is not something the client can set — the JWT is signature-verified before the request touches Postgres. That's what makes `user_id = auth.uid()` a real check and not a suggestion.

Write `(select auth.uid())` rather than bare `auth.uid()` inside policies: Postgres caches the sub-select as an InitPlan and evaluates it once per query instead of once per row. Same semantics, dramatically better plans.

Also add `to authenticated` on **every** policy. A policy without a role clause applies to `anon` too, and `auth.uid()` is `NULL` for `anon`. Today `NULL = user_id` is `NULL` (denied), which is fine — but the day someone writes a policy with an `or` or an `is not distinct from`, the missing role clause turns into a hole. Make "logged out matches nothing" structural.

### B.1 `expenses` and `incomes` (identical shape)

```sql
alter table public.expenses enable row level security;

create policy "expenses_select_own" on public.expenses
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "expenses_insert_own" on public.expenses
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "expenses_update_own" on public.expenses
  for update to authenticated
  using      ( (select auth.uid()) = user_id )   -- which rows I may target
  with check ( (select auth.uid()) = user_id );  -- what the row may become

create policy "expenses_delete_own" on public.expenses
  for delete to authenticated
  using ( (select auth.uid()) = user_id );
```

#### The `WITH CHECK` trap, stated precisely

`USING` decides **which existing rows you can see or target**. `WITH CHECK` decides **what a row is allowed to look like after you write it**. They are different questions and beginners answer only the first.

The three ways this actually goes wrong:

1. **`for insert with check (true)`** — copied from a "get started fast" tutorial. There is no `USING` on `INSERT`, so this policy is the *entire* insert authorization, and it authorizes everything. Anyone with the anon key inserts rows owned by anyone.
2. **`with check (auth.uid() is not null)`** — the subtlest one, because it *looks* like a security check and passes a single-user test. It means "any logged-in person may write any row for any owner". "Authenticated" is not "authorized". **The check must name `user_id`.**
3. **`for update using (user_id = auth.uid())` with a permissive check** — lets you *move* your row to another user (or, with a bad `USING`, pull theirs to you). Always constrain the post-image.

Two mitigations, layered:

- `default auth.uid()` on the column (§A.3) means the client has no reason to send `user_id`, so the field never appears in your forms or actions and can't be tampered with by editing a request body.
- The `WITH CHECK` catches it anyway if someone does send one.

Technical footnote so you're not confused reading the docs: for an `UPDATE` policy with a `USING` but no `WITH CHECK`, Postgres uses the `USING` expression as the check too — so omitting it here happens to be safe. Write it explicitly regardless. Explicit is what a reviewer can verify at a glance, and it protects you when you later add an `OR` to one of the two clauses.

### B.2 `categories` — read-only reference data

```sql
alter table public.categories enable row level security;

create policy "categories_select_all" on public.categories
  for select to authenticated
  using ( true );
-- No INSERT, UPDATE, or DELETE policy. Deliberately.
```

`using (true)` is correct here and only here: category names and plant sprites are not private, and there is no `user_id` to scope by. The security property comes from the **absence** of write policies. With RLS on and no write policy, every client write is denied by default — no expression to get wrong. Seeding happens in the migration (which runs as a privileged role, outside the client's reach).

Requirement 4 says "fixed set". This is what "fixed" means at the database level.

### B.3 `savings_overrides`

```sql
alter table public.savings_overrides enable row level security;

create policy "so_select_own" on public.savings_overrides for select to authenticated
  using ( (select auth.uid()) = user_id );
create policy "so_insert_own" on public.savings_overrides for insert to authenticated
  with check ( (select auth.uid()) = user_id );
create policy "so_update_own" on public.savings_overrides for update to authenticated
  using ( (select auth.uid()) = user_id ) with check ( (select auth.uid()) = user_id );
create policy "so_delete_own" on public.savings_overrides for delete to authenticated
  using ( (select auth.uid()) = user_id );
```

Plus the lock guard as a trigger (RLS can't easily express "no row exists in another table"):

```sql
create or replace function public.reject_override_on_closed_month()
returns trigger language plpgsql as $$
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
```

This trigger is intentionally **`SECURITY INVOKER` (the default)** — it runs as the user, so its `select` on `monthly_closes` is filtered by that user's own `SELECT` policy. That's exactly right: it can only see the user's own closes, which is all it needs. Don't "fix" it by adding `security definer`.

### B.4 `monthly_closes` — the black box

```sql
alter table public.monthly_closes enable row level security;

create policy "mc_select_own" on public.monthly_closes
  for select to authenticated
  using ( (select auth.uid()) = user_id );

-- NO insert policy. NO update policy. NO delete policy. Ever.
revoke insert, update, delete on public.monthly_closes from authenticated, anon;
```

**Should locked rows be immutable at the DB level rather than only in the UI? Yes, and it isn't close.** A "locked" state enforced only by a disabled button is not locked at all — the row is one `PATCH` to `/rest/v1/monthly_closes?id=eq.…` away from being rewritten, using the anon key printed in your own bundle.

Three sub-points a beginner will miss:

1. **Blocking `UPDATE` without blocking `DELETE` is not immutability.** Delete-then-reinsert rewrites history just as effectively. Both must go.
2. **Blocking writes without blocking `INSERT` is worse than nothing.** If clients can insert into `monthly_closes`, a user can fabricate a sealed record with `total_income_cents = 99999999` before the real seal ever runs, and the `unique (user_id, month)` constraint then *protects the forgery* from being corrected. Client insert must be impossible.
3. **Immutability by absence of policy beats immutability by clever policy.** The tempting alternative is `for update using (user_id = auth.uid() and closed_at is null)`. It works, but it's an expression you have to reason about, and the moment you add an `or` for some UI convenience the guarantee is gone. Zero write policies has no expression to audit.

If you take the v2 `close_adjustments` path, that table also gets only `SELECT` and `INSERT` policies — never `UPDATE` or `DELETE`. Append-only is the whole point of an audit trail.

### B.5 Functions

**Read functions: leave them `SECURITY INVOKER`.** That is the Postgres default, so the rule is literally *"do not type `security definer` on anything that reads user data."* An invoker-rights function runs as the caller, so base-table RLS applies inside it and it cannot see other users' rows even if you forget a `where user_id = ...`. Defense in depth for free.

**The one legitimate `SECURITY DEFINER` function** is the sealer, because sealing is by definition a privileged write: it must insert into a table clients cannot write.

```sql
create or replace function public.seal_month(p_month date)
returns public.monthly_closes
language plpgsql
security definer
set search_path = ''                     -- critical, see below
as $$
declare
  v_uid       uuid := auth.uid();        -- identity from the JWT, never a parameter
  v_tz        text;
  v_this      date;
  v_row       public.monthly_closes;
  v_income    bigint;
  v_expense   bigint;
  v_manual    bigint;
  v_cats      jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.timezone into v_tz from public.profiles p where p.id = v_uid;
  v_this := date_trunc('month', (now() at time zone coalesce(v_tz,'UTC')))::date;
  p_month := date_trunc('month', p_month)::date;

  if p_month >= v_this then
    raise exception 'cannot seal the current or a future month' using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_cents),0) into v_income from public.incomes
   where user_id = v_uid and occurred_on >= p_month and occurred_on < (p_month + interval '1 month');

  select coalesce(sum(amount_cents),0) into v_expense from public.expenses
   where user_id = v_uid and occurred_on >= p_month and occurred_on < (p_month + interval '1 month');

  select coalesce(jsonb_object_agg(category_slug, total_cents), '{}'::jsonb) into v_cats
    from public.v_category_month_totals
   where user_id = v_uid and month = p_month;

  select manual_net_cents into v_manual from public.savings_overrides
   where user_id = v_uid and month = p_month;

  insert into public.monthly_closes
    (user_id, month, total_income_cents, total_expense_cents, manual_net_cents, category_totals)
  values (v_uid, p_month, v_income, v_expense, v_manual, v_cats)
  on conflict (user_id, month) do nothing        -- idempotent: safe to call on every page load
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.monthly_closes where user_id = v_uid and month = p_month;
  end if;
  return v_row;
end $$;

revoke all on function public.seal_month(date) from public, anon;
grant execute on function public.seal_month(date) to authenticated;
```

Why this specific `SECURITY DEFINER` is safe, in the three properties that make it so:

- **Identity is re-derived, never accepted.** `auth.uid()` inside the function body. There is no `p_user_id` parameter, so there is nothing to forge. (`auth.uid()` works fine inside a definer function — it reads the request's JWT claims setting, which is independent of the executing role. It returns `NULL` when there's no JWT, hence the explicit guard.)
- **No user-supplied amounts.** Every number is a `sum()` over rows the function looked up itself. The user's only input is a month, which is validated and normalized.
- **`set search_path = ''` plus fully-qualified names everywhere.** Without this, a definer function resolves unqualified names through the caller's `search_path`; if an attacker can create an object in an earlier schema they can shadow `expenses` and make your elevated function read their table. `authenticated` can't create schemas in default Supabase, but Supabase's own database linter flags mutable `search_path` on definer functions precisely because this is a known escalation class. Set it and forget it.

Companion sweep for lazy sealing (also definer, same guards):

```sql
create or replace function public.seal_pending_months()
returns setof public.monthly_closes ...
-- loops from the month of the user's earliest transaction (or last close)
-- through the month before "now", calling seal_month for each. Idempotent.
```

Also the profile bootstrap trigger — a definer function by necessity, since `auth.users` is not writable by clients:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, null)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

`profiles` therefore needs **no `INSERT` policy** — only `SELECT` and `UPDATE`, both scoped to `(select auth.uid()) = id`.

### B.6 Views and RPCs that aggregate — the single most likely leak in this design

This deserves its own callout because the dashboard is the feature most likely to leak, and the leak is invisible in single-user testing.

**The problem.** A Postgres view executes with the privileges of its **owner**, not the caller. In Supabase, migrations run as a privileged role, so your view is owned by that role — and that role is not subject to `expenses`' RLS. A view over `expenses` therefore returns **every user's rows** to whoever can select from the view. And Supabase's default privileges grant `select` on new `public` objects to `anon` and `authenticated`. Your beautiful `v_category_month_totals` becomes a global, unauthenticated financial data dump — and your own dashboard looks *fine*, because during development you only have one account, so "all users" and "me" are the same set.

**The fix, exactly:**

```sql
-- 1. Every view over user data gets security_invoker. No exceptions.
create view public.v_category_month_totals with (security_invoker = on) as ...;
alter  view public.v_month_savings set (security_invoker = on);   -- for existing views

-- 2. Belt and braces: anon has no business here at all.
revoke all on public.v_category_month_totals from anon;
revoke all on public.v_month_savings          from anon;
grant  select on public.v_category_month_totals to authenticated;
grant  select on public.v_month_savings          to authenticated;
```

`security_invoker = on` makes the view run with the *caller's* permissions, so base-table RLS applies inside it and each user sees only their own aggregate. Requires Postgres 15+, which every current Supabase project is.

Three more things to internalize:

- **You cannot create RLS policies on a plain view.** People try. The view's protection comes entirely from `security_invoker` plus RLS on the base tables. There is no second mechanism.
- **`GROUP BY` does not anonymize.** `v_category_month_totals` groups by `user_id`, so a leaking view hands out a per-user financial profile keyed by UUID — arguably worse than raw rows, because it's pre-summarized.
- **For RPCs, the danger is the opposite direction.** Functions default to `SECURITY INVOKER` (safe); the leak happens when a beginner copies `security definer` from a tutorial into a read function like `get_monthly_totals()`, at which point the function ignores RLS and, if it takes a `p_user_id` parameter, becomes a *parameterized* cross-user read endpoint: `rpc('get_monthly_totals', { p_user_id: '<someone-else>' })`. **Rule: a function that both is `SECURITY DEFINER` and takes a user id as a parameter is a data-leak API. If you need definer, derive the identity from `auth.uid()` inside.**

Verification step, worth doing once per view:

```sql
select c.relname, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public';
-- every row must show {security_invoker=on}

select tablename, rowsecurity from pg_tables where schemaname = 'public';
-- every row must show rowsecurity = true
```

Supabase's Database Advisors / linter flags both "RLS disabled in public" and "security definer view" automatically. Run it before you submit and screenshot a clean result — that's a free grading point.

### B.7 Keys: anon vs. service_role

| Key | Where it may appear | What it can do |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Anywhere, including the browser bundle | Identifies your project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (newer projects: publishable key, `sb_publishable_…`) | Anywhere, including the browser bundle. **This is designed to be public** | Nothing on its own. Every request it makes is subject to RLS as `anon`, or as `authenticated` once a user session's JWT rides along |
| `SUPABASE_SERVICE_ROLE_KEY` (newer: secret key, `sb_secret_…`) | **Nowhere in this project.** Not in `.env.local`, not in Vercel, not in a comment | The `service_role` role has `BYPASSRLS`. Every policy in section B becomes decorative. It is a root password for the entire database of every user |

**The strongest recommendation in this document: do not put the service_role key in this project at all.** Every feature here — including month-end sealing — is achievable with the anon key plus a signed-in user's session plus the one `SECURITY DEFINER` RPC. A key that doesn't exist in your `.env` cannot be leaked by a bad import, a debug `console.log`, an accidental `git add -A`, or a Vercel env var pasted into the wrong scope. Delete the line from the file the tutorial told you to create.

If you ever do add it, the hard rules:

- **Never** prefix a secret with `NEXT_PUBLIC_`. Next.js *inlines* `NEXT_PUBLIC_*` values into the client JavaScript at build time. There is no undo; the key is in your users' browsers and your deployment history.
- Never `import` a module that reads it from a file with `'use client'`, or from any module that a client component imports — the module graph, not your intent, decides what ships. A single shared `lib/supabase.ts` that reads both keys and gets imported by a client component is the standard way this leak happens.
- `.gitignore` must contain `.env*` (keep `.env.example`). Check history: `git log -p --all -S 'service_role'`. If it ever appears, rotate the key in the dashboard — deleting the file doesn't help.
- `force row level security` on a table applies RLS even to the table owner, but it **does not stop `service_role`**, because `BYPASSRLS` is a role attribute checked before policies. There is no database-side mitigation for a leaked service key. Only absence works.

---

## C. App / folder structure

```
sprint-secured-app/
├── middleware.ts                    # session cookie refresh + UX redirect ONLY
├── .env.local                       # gitignored; URL + ANON key only
├── .env.example                     # committed, with placeholder values
├── supabase/
│   ├── migrations/
│   │   ├── 0001_profiles.sql        # table + RLS + handle_new_user trigger
│   │   ├── 0002_categories.sql      # table + RLS + seed insert
│   │   ├── 0003_expenses.sql        # table + RLS + indexes
│   │   ├── 0004_incomes.sql
│   │   ├── 0005_savings.sql         # savings_overrides + monthly_closes + RLS
│   │   ├── 0006_views.sql           # security_invoker views + grants/revokes
│   │   └── 0007_seal.sql            # seal_month, seal_pending_months
│   └── tests/rls.sql                # the two-account test from §D.12
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # createBrowserClient  — client components
│   │   ├── server.ts                # createServerClient(cookies()) — RSC/actions
│   │   └── middleware.ts            # updateSession() helper for middleware.ts
│   ├── auth.ts                      # requireUser(): getUser() or redirect('/login')
│   ├── money.ts                     # toCents / formatCents  — the ONLY money math
│   ├── month.ts                     # startOfMonth / nextMonth / monthKey
│   ├── growth.ts                    # growthStage(total, target) — pure, no DB
│   └── validation.ts                # zod schemas, shared by every server action
├── components/
│   ├── garden/
│   │   ├── Garden.tsx               # 'use client' — receives aggregates as props
│   │   └── Plant.tsx                # 'use client' — CSS/spring animation only
│   └── ui/…
└── app/
    ├── layout.tsx
    ├── page.tsx                     # marketing / redirect to /dashboard
    ├── (auth)/                      # route group: no session required
    │   ├── layout.tsx               # centered card shell
    │   ├── login/page.tsx           # client form -> server action
    │   ├── signup/page.tsx
    │   └── actions.ts               # 'use server': signIn / signUp / signOut
    ├── auth/
    │   ├── callback/route.ts         # PKCE / email-confirm code exchange
    │   └── confirm/route.ts          # email OTP verification
    └── (app)/                        # route group: session required
        ├── layout.tsx                # await requireUser() — server-side gate
        ├── dashboard/page.tsx        # RSC: seal_pending_months() + read views
        ├── expenses/
        │   ├── page.tsx              # RSC list
        │   └── actions.ts            # createExpense / updateExpense / deleteExpense
        ├── income/{page.tsx,actions.ts}
        ├── months/[month]/
        │   ├── page.tsx              # one month: calculated vs manual vs effective
        │   └── actions.ts            # setOverride / clearOverride / sealMonth
        └── review/[year]/page.tsx    # yearly: top plant + savings across months
```

### Where the Supabase clients live, and why three of them

| File | Client | Used by |
|---|---|---|
| `lib/supabase/client.ts` | `createBrowserClient(url, anonKey)` | Client components only. Reads the session from cookies. Safe: RLS-bound |
| `lib/supabase/server.ts` | `createServerClient(url, anonKey, { cookies })` | Server components, server actions, route handlers. **Uses the anon key too** — the user's JWT comes from the request cookie, so the query runs as *that user* and RLS still applies |
| `lib/supabase/middleware.ts` | `createServerClient` with a request/response cookie bridge | `middleware.ts` only, to refresh the expiring access token and write the new cookie back |

Three files, one key. If you find yourself wanting a fourth "admin client", stop and read §D.4.

Do **not** create a single shared `lib/supabase.ts` exporting everything — that's how a server-only module ends up in the client graph.

### Server components vs. client components

- **Server components fetch.** Every page in `(app)` is an RSC that creates the server client, queries the view, and passes plain aggregate numbers down as props. No data fetching in `useEffect`.
- **Client components animate and collect input.** `Garden`/`Plant` take `{ categorySlug, totalCents, targetCents }[]` and animate. They never query, so they can't over-fetch or leak.
- **Auth check in `app/(app)/layout.tsx`:** `const user = await requireUser()`. This runs server-side on every request into the group, is composable, and cannot be skipped by a middleware matcher typo.

### Server actions vs. route handlers

**Server actions for every mutation** — create/update/delete expense and income, set/clear override, seal a month. They're same-origin, typed end to end, and pair with `revalidatePath` so the garden re-renders from fresh derived data.

**Route handlers only for `app/auth/callback/route.ts` and `app/auth/confirm/route.ts`**, because Supabase's email links redirect the *browser* to a URL that must exchange a code for a session and set cookies. That's a GET request from outside your app, which is what route handlers are for. Nothing else needs one.

**The server-action trap.** A server action is a publicly reachable HTTP endpoint with a generated ID. Being "in a server file" is not authorization. Therefore every action, without exception:

```ts
'use server';
export async function createExpense(formData: FormData) {
  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();   // NOT getSession()
  if (error || !user) throw new Error('Unauthorized');

  const input = ExpenseSchema.parse({           // zod: shape + bounds
    category_slug: formData.get('category_slug'),
    amount_cents:  toCents(String(formData.get('amount'))),
    occurred_on:   formData.get('occurred_on'),
    description:   formData.get('description'),
  });

  // note: no user_id. The column default is auth.uid(); RLS WITH CHECK enforces it.
  const { error: insErr } = await supabase.from('expenses').insert(input);
  if (insErr) throw insErr;
  revalidatePath('/dashboard');
}
```

Two named rules inside that snippet:

- **`getUser()`, never `getSession()`, in server code.** `getSession()` reads and decodes the cookie without contacting the auth server; a forged or stale cookie can produce a session-shaped object. `getUser()` validates the JWT. Use `getSession()` only for cheap client-side "is there probably a session" UI.
- **No server action ever takes a `userId` parameter.** If an action's signature contains a user id, it is an authorization bug waiting for someone to open devtools. Identity comes from the cookie, always.

### Middleware is not a security boundary. RLS is.

`middleware.ts` does two things: refresh the Supabase auth cookie so sessions don't expire mid-session, and redirect signed-out users to `/login` so they see a login form instead of an error. Both are **user experience**.

Why it isn't a boundary, concretely:

- It's a `matcher` regex. One typo (or a new route added outside the pattern, or a subtle static-asset exclusion) silently unprotects a page. Silent failure is the worst property a security control can have.
- Direct requests to server actions and route handlers can bypass the assumptions you made in middleware.
- It has actually been bypassed in the wild: Next.js **CVE-2025-29927** allowed skipping middleware entirely via a crafted `x-middleware-subrequest` header. Any app whose *only* auth check was in middleware was fully exposed by a framework bug it had no control over.
- Most fundamentally: middleware protects **routes**. Your data isn't behind a route — it's behind PostgREST, which the anon key can reach directly from `curl`, no Next.js involved.

So: **middleware for UX, `requireUser()` in the layout and every action for app-level checks, and RLS as the actual boundary.** The test of whether you've built it right: *if I deleted `middleware.ts` entirely, could anyone read another user's data?* The answer must be no.

---

## D. Weak points and risks, ranked

Ranked by (likelihood for a beginner) × (severity). Each: the trap, the failure mode, the fix.

### D.1 — CRITICAL. A table ships with RLS never enabled, or with `using (true)`

**Failure mode.** `create table public.expenses (...)` and you move on to the UI because it works. Supabase's default grants mean `anon` already has `select` on it. Your anon key is in the JS bundle. Anyone can run `curl "$URL/rest/v1/expenses?select=*" -H "apikey: <anon>"` and download every user's complete financial history. This is the most common real-world Supabase breach, not a theoretical one, and it fails *open* — the app looks perfect.

**Fix.** `enable row level security` in the **same migration** as the `create table`; treat a migration that creates a table without it as a syntax error. Then run Supabase's Database Advisors and require zero "RLS disabled in public" findings. Then run §D.12's test.

### D.2 — CRITICAL. The aggregating view/RPC leaks across users

**Failure mode.** Precisely §B.6: a view over `expenses` without `security_invoker` runs as its privileged owner, ignores RLS, and returns everyone's per-category monthly totals. It is invisible during development (one account ⇒ "all rows" and "my rows" look identical) and it sits behind the app's most-visited page.

**Fix.** `with (security_invoker = on)` on every view over user data; `revoke all ... from anon`; never `security definer` on a read function; and for any definer function, derive identity from `auth.uid()` internally rather than accepting it as a parameter. Verify via the `pg_class.reloptions` query in §B.6, and make the two-account test hit `/dashboard` specifically, not just the expense list.

### D.3 — CRITICAL. The savings override: a user-supplied number replacing a server-computed one

This is the riskiest surface in the app, exactly as you suspected — it is the only place the design *intends* to accept a number that contradicts the database.

**Failure modes, each concrete:**

| # | Failure | Consequence |
|---|---|---|
| 1 | Action accepts `{ userId, month, amount }` and inserts it | Direct cross-user write. Someone rewrites your savings |
| 2 | Override and snapshot totals in the same row with table-wide `UPDATE` granted | The user PATCHes `total_income_cents`, not just the override. Now the "calculated" value is forged too and the audit story is gone |
| 3 | No bounds validation | `9e18` overflows `bigint`; `1e999` → `Infinity` → `null` in JSON; `"abc"` → `NaN`; the yearly chart's y-axis becomes unreadable and the review page crashes for that user permanently |
| 4 | Override writable after lock-in | The "black box" (req. 9) is a lie. Nothing in the app is trustworthy after that |
| 5 | Override *replaces* the calculated value in storage | Irreversible. No way to answer "what did the system actually compute?" or to revert. Also destroys the requirement's explicit "store BOTH" |
| 6 | `parseFloat` on a decimal input | `19.99` → float → cents rounding drift. In a savings total, off by cents forever |
| 7 | Override silently ignored when it's `0` (`manual \|\| calculated`) | "I saved exactly nothing this month" is a legitimate, meaningful correction and it vanishes |

**Fixes, in order of importance:**

1. **Separate table** (§A.5.1). `savings_overrides` contains *only* user-authored fields. Failure #2 becomes structurally impossible — there is no server-computed column in the row to overwrite. If you insist on one table instead, you must add column-level grants: `revoke update on monthly_closes from authenticated; grant update (manual_net_cents, note) on monthly_closes to authenticated;` — column privileges are checked independently of RLS and are the right tool for "which columns may be written". But two tables need no such precision.
2. **Never accept identity.** No `userId` parameter; `default auth.uid()` + `WITH CHECK`.
3. **Validate at both layers.** Zod in the action (`z.number().int().finite().min(-1e11).max(1e11)`) **and** a `CHECK` constraint on the column. The zod check gives a nice error message; the `CHECK` is the one that actually holds, because PostgREST is reachable without your action.
4. **Keep the calculated value forever.** The override is additive metadata, never a replacement. `manual_net_cents = NULL` is "revert" — a one-click undo, and a permanent record of what the system computed vs. what the human claimed.
5. **Not writable after lock-in.** Enforced by the `so_no_closed_months` trigger *and* by `monthly_closes` having no write policies. Post-lock correction, if needed, is an append-only `close_adjustments` row with a mandatory `reason` — history grows, it never mutates.
6. **Audit trail.** `created_at`/`updated_at` on the override, `manual_net_cents` frozen into the close row at seal time, and `amount_source` generated so a closed month self-reports "this figure is the user's, not mine".
7. **Show both in the UI.** Render "Calculated €412.30 · your correction €380.00 (used)" with a Revert control. A corrupted or absurd override becomes immediately visible instead of silently poisoning the yearly review.

### D.4 — CRITICAL. Reaching for `service_role` to make something work

**Where the instinct strikes, and what to do instead:**

| "I'll just use the service key because…" | What's actually wrong | Do this instead |
|---|---|---|
| "My `select` returns `[]` even though rows exist" | Missing `SELECT` policy, or you used the browser client where there's no session, or you're querying as `anon` | Add the policy / use the right client. An empty result is RLS working |
| "I need to insert on the user's behalf from a server action" | Nothing needs elevation. The server client carries the user's JWT from the cookie | Use `lib/supabase/server.ts` with the anon key |
| "The month-end job needs to write everyone's closes" | True elevation need, but a service key is the blunt instrument | `SECURITY DEFINER` RPC with server-derived inputs (§B.5, §D.6) |
| "I need to seed the categories" | Migrations already run privileged | `insert` in the migration file |
| "I want an admin page to see all users" | Not a requirement. It's the largest possible attack surface for zero grading credit | Don't build it |

**Failure mode when you do it anyway:** the service key ends up in a module that a client component imports (or gets `NEXT_PUBLIC_`-prefixed "temporarily"), Next.js inlines it into the bundle, and every RLS policy in this document becomes decorative for anyone who opens devtools. There is no database-side mitigation — `service_role` has `BYPASSRLS`, checked before policies run.

**Fix: the key never enters the project.** Not in `.env.local`, not in Vercel, not in a commented-out line. Absence is the only control that can't be misconfigured.

### D.5 — HIGH. The growth animation: derived-vs-cached tension, and the `growth_level` column temptation

**The tension is real.** The garden re-renders on every navigation, each render needs 6–12 aggregate numbers, and a beginner's instinct is "this is wasteful, let me store the plant size."

**Why a mutable `growth_level` column is a genuine security and correctness hole, not just bad style:**

- **It becomes a forgeable field.** Any client-writable column on a user-owned row can be written by that user. `PATCH /rest/v1/expenses_growth?…` with `{"growth_level": 999}` — your carefully derived, honest garden now displays whatever the user typed. For a *financial* app whose whole premise is "the plant reflects your real spending", that's a data-integrity failure with a straight-faced exploit.
- **It drifts.** Delete a €500 expense; the plant stays huge until something remembers to recompute. Now you need triggers on insert/update/delete on `expenses`, and each is a new code path with its own bug budget. Requirement 5 forbids this for exactly this reason.
- **It turns the monthly reset (req. 6) into a scheduled job that can fail.** Derived-per-month, the reset is `where month = $1` — it cannot fail, cannot run twice, cannot run late. A stored `growth_level` needs a cron that zeroes every row at every user's local month boundary, and if it misfires the garden shows last month's plants as this month's.
- **Two sources of truth means the dashboard and the yearly review will eventually disagree**, and you won't know which is lying.

**Over-fetching, which is the legitimate concern underneath:**

- **Trap:** `select('*').from('expenses')` and `reduce()` in the browser. Hundreds of rows on the wire to render six plants, plus it habituates "filter in the client" — which is not a security control, and is how a policy mistake turns into an actual leak.
- **Fix:** query `v_category_month_totals` for one `user_id` + one `month`. That's ≤ 12 rows, one index range scan. Fetch it in the RSC and pass numbers as props.
- **Fix:** the animation is client-side only — `<Plant stage={growthStage(totalCents, target)} />` with a CSS transition or spring. Do **not** poll, and do **not** subscribe to realtime for this; the numbers change only when the user themselves adds an expense, and `revalidatePath('/dashboard')` after the mutation is exactly the right invalidation.
- **If it were ever genuinely slow** (it won't be at this scale): cache in React/Next request memoization first; a matview in a *private* schema refreshed by a definer function second; **a client-writable column never**.

### D.6 — HIGH. The month-end lock-in job: what runs it, with which key

**Three options and what each costs:**

| Runner | Key / role | Risk |
|---|---|---|
| **`pg_cron`** | Runs as the `postgres` superuser — `BYPASSRLS`, no JWT, so **`auth.uid()` is `NULL` inside it** | The job must loop `select id from auth.users` and set `user_id` explicitly for every insert. One misplaced loop variable writes user A's totals into user B's sealed record — a silent, permanent, cross-user data corruption in exactly the table you promised was immutable. RLS provides *zero* backstop here because the role bypasses it |
| **Edge Function + `service_role`** | Same bypass, plus the service key now lives in a second environment with its own secret management | All of the above, plus the key exists (see §D.4). Also needs its own scheduler anyway |
| **Lazy on-read, `SECURITY DEFINER` RPC called by the signed-in user** ✅ | Anon key + the user's own JWT. `auth.uid()` is populated and authoritative | The function can only ever touch `auth.uid()`'s data because that's the only identity it has. Cross-user corruption is not expressible |

**Recommendation: lazy on-read sealing.** `app/(app)/dashboard/page.tsx` calls `supabase.rpc('seal_pending_months')` before it reads. The function is idempotent (`unique (user_id, month)` + `on conflict do nothing`), refuses to seal the current or a future month, and derives the boundary from the user's own `profiles.timezone`.

**Why this choice matters for RLS specifically:** cron and Edge Functions run *without a user*, so they must reconstruct "which user" from data — and a bug in that reconstruction is a cross-tenant write that RLS cannot catch, because the runner bypasses RLS by design. The lazy RPC runs *as a user*, so "which user" is supplied by a signature-verified JWT and cannot be gotten wrong.

**Accepted tradeoffs, stated honestly:**
- A user who doesn't log in for three months gets three months sealed on next login. Fine — arguably better, since sealing happens in their session with their timezone.
- Sealing happens at first-login-after-month-end, not at midnight. So a backdated expense entered on the 2nd, before login, *is* included. Correct behavior, and it means the UI must tell the user "September is sealed — this entry won't change your sealed record" when they backdate into a closed month.
- Because closes are snapshots, **the yearly review (reqs. 7 and 10) must read `monthly_closes` for closed months**, not recompute from `expenses`. Recomputing would silently rewrite "the past" whenever the user edits old data, which defeats the black box.
- Adding a nightly `pg_cron` sweep later is possible, but only as an optimization, and it must reuse `seal_month`'s logic with an explicit per-user loop and extra review. Don't start there.

### D.7 — HIGH. Per-user data in a shared cache

**Failure mode.** A beginner adds `export const revalidate = 3600` to `/dashboard` to "make it fast", or wraps a query in `unstable_cache` with a key that doesn't include the user id. Next.js now serves *one* cached HTML page or one cached result to *every* user. User B opens the dashboard and sees user A's garden and savings. RLS was perfect; the leak happened above it, in your framework's cache. This is a real and recurring class of Next.js incident.

**Fix.**
- Nothing in `(app)` is statically cached. Reading cookies via the Supabase server client makes the route dynamic already — don't fight that with explicit cache config.
- Never call `unstable_cache`/`cacheLife`-style APIs on user-scoped data. If you must, the user id is part of the cache key, always.
- After every mutation: `revalidatePath('/dashboard')`. That's the only cache management this app needs.
- Set `Cache-Control: private, no-store` on any route handler that returns user data.

### D.8 — MEDIUM-HIGH. Month/timezone off-by-one in a financial record

**Failure mode.** `new Date().getMonth()` on the client decides the current month; a user in UTC+13 (or anyone at 11pm on the 31st) seals a month early or files an expense into the wrong month. Or `occurred_on` is `timestamptz` and a Sept 1 00:30 expense renders in August. Or months are stored as `'2026-9'` and sort before `'2026-10'`... after `'2026-1'`. In a savings ledger these are not cosmetic — they change the sealed numbers.

**Fix.** `date` for events; first-of-month `date` for months, with a `check`; `timestamptz` only for audit; "current month" computed server-side from `profiles.timezone`; one `lib/month.ts` used by every caller; and range predicates (`>= start and < next`) rather than `date_trunc(...) =` so the index is used.

### D.9 — MEDIUM. Auth session handling mistakes

**Failure modes.** `getSession()` in a server action (trusts an unverified cookie); missing cookie-refresh in middleware (users randomly logged out mid-form, or a redirect loop between `/login` and `/dashboard`); no `/auth/callback` handler so email-confirmation links dead-end; email confirmation disabled so anyone signs up with anyone's address.

**Fix.** `getUser()` everywhere on the server. Middleware refreshes the token and writes the cookie back on the *same* response object it returns. Implement both `auth/callback` and `auth/confirm`. In the Supabase dashboard: email confirmations **on**, a sane minimum password length, and leaked-password protection enabled. And never hand-roll password hashing or your own session cookie — Supabase Auth exists precisely so a beginner doesn't have to get that right.

### D.10 — MEDIUM. Client-side validation mistaken for validation

**Failure mode.** `<input type="number" min="0" required>` and a zod schema in the action, but nothing in the database. Since PostgREST is directly reachable with the public anon key, `curl` inserts `amount_cents: -50000`, `description` of 4MB, `occurred_on: '9999-12-31'`, or `category_slug: 'lol'`. Negative expenses inflate savings; a far-future date poisons month grouping forever.

**Fix.** Every invariant lives in the schema as a `CHECK` or `FK` (§A). Zod mirrors them for good error messages. When they disagree, the database is right. Remember the immutability rule for `CHECK` — enforce "not far-future" in a trigger, not with `current_date`.

### D.11 — MEDIUM. Leaking identity/PII through convenience joins

**Failure mode.** A view or RPC that joins `auth.users` to show "your email" — with `security_invoker` missing, or exposed in the `public` schema, it becomes an email-harvesting endpoint. The classic Supabase leak.

**Fix.** Never build a view over `auth.users`. Read the current user's email from `supabase.auth.getUser()` on the server. Anything else about a user goes in `profiles`, RLS-scoped to `id = auth.uid()`.

### D.12 — The test that catches most of the above, in 10 minutes

Do this before you submit; it's also the single best thing to demo to a grader.

**Two-account UI test.** Create user A, add expenses across three categories and an income; create user B in a different browser profile with different data. Then, as B: visit `/dashboard`, `/expenses`, `/months/2026-08`, `/review/2026`. **Every page must show only B's data**, and B must not be able to reach A's rows by editing an id in a URL.

**Policy test in SQL** (Supabase SQL editor), which tests the database directly and so catches leaks your UI happens not to trigger:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<USER-B-UUID>","role":"authenticated"}';

select count(*) from public.expenses;                  -- must equal B's count only
select * from public.v_category_month_totals;          -- must contain only B's user_id
select * from public.monthly_closes;                   -- only B's

-- these must all FAIL:
insert into public.expenses (user_id, category_slug, amount_cents, occurred_on)
  values ('<USER-A-UUID>', 'social', 100, '2026-09-01');       -- WITH CHECK violation
update public.monthly_closes set total_income_cents = 999999;   -- no policy / no privilege
delete from public.monthly_closes;                              -- no policy / no privilege
update public.savings_overrides set manual_net_cents = 1
  where user_id = '<USER-A-UUID>';                              -- 0 rows affected
rollback;
```

Plus the two catalog queries from §B.6 (`rowsecurity = true` on every public table; `security_invoker=on` on every view), and a clean run of Supabase's Database Advisors.

---

## Build order

Security-first ordering, so nothing is ever briefly exposed:

1. Migrations 0001–0002 (`profiles`, `categories`) **with RLS**, plus the `handle_new_user` trigger. Verify with the SQL test before writing any UI.
2. Auth: the three Supabase client files, `middleware.ts`, `(auth)` routes, `auth/callback`, `requireUser()`. Confirm sign-up → confirm → log in → log out end to end.
3. Migrations 0003–0004 (`expenses`, `incomes`) **with RLS and indexes**. Run the two-account SQL test *now*, before any UI exists.
4. Expenses + income CRUD via server actions. Plain tables, no styling.
5. Migration 0006: the `security_invoker` views. **Re-run the two-account test against the views specifically** — this is D.2, the highest-value check in the project.
6. The garden: `growth.ts`, `Garden`, `Plant`, derived from the view. Requirement 6 needs no code.
7. Migration 0005 + 0007: `savings_overrides`, `monthly_closes`, `seal_month`, `seal_pending_months`. Test that a sealed month rejects update, delete, and override.
8. Month view (calculated vs. manual vs. effective vs. locked) and yearly reviews reading from `monthly_closes`.
9. Final pass: Database Advisors clean, `git log -p -S 'service_role'` empty, `.env.local` contains exactly two Supabase values, and `middleware.ts` temporarily deleted to prove nothing leaks without it.
