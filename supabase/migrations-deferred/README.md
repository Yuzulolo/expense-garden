# Deferred migrations

These are **not** applied to any database, and `npx supabase db push` does not
see them — that is the entire reason this directory exists.

| File | What it adds |
| --- | --- |
| `20260906190941_savings.sql` | `savings_overrides`, `monthly_closes` (generated columns, no write policies), the `so_no_closed_months` lock trigger |
| `20260906190942_seal.sql` | `seal_month(date)`, `seal_pending_months()` — `SECURITY DEFINER`, identity from `auth.uid()` only |

## Why they are here

Sprint 3's requirements do not include monthly closes or a savings figure.
Applying unused schema to the hosted project would add surface area to explain
and maintain for no evaluation benefit, so the decision was to write and verify
them, then stop.

They were verified against a local stack before being set aside: `monthly_closes`
has zero write policies and refuses direct INSERT/UPDATE/DELETE, `seal_month`
refuses the current and future months and is idempotent, and the lock trigger
blocks an override on a sealed month (including via an UPDATE that moves a row
into one).

## Re-activating them

Move both files back into `supabase/migrations/` and push. Their timestamps
(`20260906…`) are earlier than `20260907194453_messages.sql`, which is already
applied — `db push` applies by timestamp order but only skips what the remote
migration history records, so out-of-order application is expected here and is
fine: nothing in these two files depends on `messages`, and nothing in
`messages` depends on them.

`20260906190941_savings.sql` does depend on `public.touch_updated_at()`, created
in `20260904154520_expenses.sql`, which is applied.
