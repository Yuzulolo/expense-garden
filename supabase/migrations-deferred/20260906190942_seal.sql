-- §B.5 month-end sealing
--
-- WHY THIS IS AN RPC AND NOT A CRON JOB
--
-- pg_cron runs as a superuser and an Edge Function would run as service_role.
-- Both run WITHOUT a user, so auth.uid() is NULL inside them and they must
-- reconstruct "which user" from data — looping over auth.users and setting
-- user_id by hand. A bug in that loop writes user A's totals into user B's
-- sealed record, and RLS provides zero backstop because both runners bypass it
-- by design. That is a silent, permanent, cross-user corruption in exactly the
-- table we promised was immutable.
--
-- Called as the signed-in user instead, the function has exactly one identity —
-- the one in the verified JWT — so cross-user corruption is not expressible.
-- It also means no service_role key needs to exist anywhere in this project.

create or replace function public.seal_month(p_month date)
returns public.monthly_closes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_tz      text;
  v_this    date;
  v_row     public.monthly_closes;
  v_income  bigint;
  v_expense bigint;
  v_manual  bigint;
  v_cats    jsonb;
begin
  -- Identity is re-derived, never accepted. There is no p_user_id parameter,
  -- so there is nothing to forge. A SECURITY DEFINER function that BOTH
  -- bypasses RLS AND takes a user id as an argument is a data-leak API.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.timezone into v_tz from public.profiles p where p.id = v_uid;

  v_this  := date_trunc('month', (now() at time zone coalesce(v_tz, 'UTC')))::date;
  p_month := date_trunc('month', p_month)::date;

  -- The current month is still accumulating; a future month is meaningless.
  if p_month >= v_this then
    raise exception 'cannot seal the current or a future month'
      using errcode = 'check_violation';
  end if;

  -- Every number below is a sum() over rows this function looked up itself.
  -- The user's only input is a month, which has been validated and normalised.
  select coalesce(sum(amount_cents), 0) into v_income
    from public.incomes
   where user_id = v_uid
     and occurred_on >= p_month
     and occurred_on <  (p_month + interval '1 month');

  select coalesce(sum(amount_cents), 0) into v_expense
    from public.expenses
   where user_id = v_uid
     and occurred_on >= p_month
     and occurred_on <  (p_month + interval '1 month');

  -- Read the base table, not v_category_month_totals: this function is
  -- SECURITY DEFINER, so it is not subject to RLS, and a security_invoker view
  -- consulted from here would filter by the DEFINER's identity, not v_uid.
  -- The explicit user_id predicate is what scopes this one.
  select coalesce(
           jsonb_object_agg(t.category_slug, t.total_cents),
           '{}'::jsonb
         )
    into v_cats
    from (
      select e.category_slug, sum(e.amount_cents)::bigint as total_cents
        from public.expenses e
       where e.user_id = v_uid
         and e.occurred_on >= p_month
         and e.occurred_on <  (p_month + interval '1 month')
       group by e.category_slug
    ) t;

  select o.manual_net_cents into v_manual
    from public.savings_overrides o
   where o.user_id = v_uid and o.month = p_month;

  insert into public.monthly_closes
    (user_id, month, total_income_cents, total_expense_cents,
     manual_net_cents, category_totals)
  values
    (v_uid, p_month, v_income, v_expense, v_manual, v_cats)
  on conflict (user_id, month) do nothing   -- idempotent: safe on every page load
  returning * into v_row;

  -- on conflict do nothing returns no row when the close already exists.
  if v_row.id is null then
    select * into v_row
      from public.monthly_closes
     where user_id = v_uid and month = p_month;
  end if;

  return v_row;
end $$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so a SECURITY
-- DEFINER function in public is a callable endpoint until revoked.
revoke all on function public.seal_month(date) from public, anon;
grant execute on function public.seal_month(date) to authenticated;

-- ============================================================================
-- The sweep the dashboard calls: seal everything still open and already past.
-- ============================================================================

create or replace function public.seal_pending_months()
returns setof public.monthly_closes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_tz    text;
  v_this  date;
  v_start date;
  v_m     date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.timezone into v_tz from public.profiles p where p.id = v_uid;
  v_this := date_trunc('month', (now() at time zone coalesce(v_tz, 'UTC')))::date;

  -- Start at the month after the last close, or at the user's earliest
  -- transaction if they have never sealed anything.
  select date_trunc('month', max(c.month) + interval '1 month')::date
    into v_start
    from public.monthly_closes c
   where c.user_id = v_uid;

  if v_start is null then
    select date_trunc('month', min(d.occurred_on))::date
      into v_start
      from (
        select occurred_on from public.expenses where user_id = v_uid
        union all
        select occurred_on from public.incomes  where user_id = v_uid
      ) d;
  end if;

  -- No transactions at all: nothing to seal.
  if v_start is null then
    return;
  end if;

  v_m := v_start;
  while v_m < v_this loop
    return next public.seal_month(v_m);
    v_m := (v_m + interval '1 month')::date;
  end loop;

  return;
end $$;

revoke all on function public.seal_pending_months() from public, anon;
grant execute on function public.seal_pending_months() to authenticated;
