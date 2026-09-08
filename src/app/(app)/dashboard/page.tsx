import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentMonthFor, monthLabel } from "@/lib/month";
import { formatCents } from "@/lib/money";
import { Garden, type Plant } from "./garden";
import { logExpenseFromText } from "../expenses/ai-actions";
import { LogExpense } from "../expenses/log-expense";
import { PARSE_MODEL, formatModelSlug } from "@/lib/ai/models";

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Which month is "now" comes from the user's stored timezone, server-side.
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

  const month = currentMonthFor(profile?.timezone);

  // Two small reads, both aggregated in Postgres:
  //   - one row per active category (labels and sprites, not hardcoded)
  //   - at most one totals row per category FOR THIS MONTH ONLY
  //
  // Deliberately NOT select('*') from expenses: pulling a user's whole
  // transaction history to the browser to draw six plants is the over-fetch
  // §D.5 warns about, and it trains the habit of filtering in the client.
  // There is also no .eq('user_id', ...) here — RLS adds that itself, inside
  // the view, because the view is declared security_invoker = on.
  const [
    { data: categories, error: categoriesError },
    { data: totals, error: totalsError },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("slug, label, plant_key")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("v_category_month_totals")
      .select("category_slug, total_cents, entry_count")
      .eq("month", month),
  ]);

  const error = categoriesError ?? totalsError;
  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold">Garden</h1>
        <p
          role="alert"
          className="border-l-2 border-danger pl-3 text-sm text-danger"
        >
          Could not load the garden: {error.message}
        </p>
      </section>
    );
  }

  const byCategory = new Map(
    (totals ?? []).map((t) => [
      t.category_slug as string,
      { total: Number(t.total_cents), count: Number(t.entry_count) },
    ]),
  );

  // Every active category gets a plant, including ones with no spending this
  // month — they render dormant rather than vanishing from the garden.
  const plants: Plant[] = (categories ?? []).map((c) => {
    const hit = byCategory.get(c.slug as string);
    return {
      slug: c.slug as string,
      label: c.label as string,
      plantKey: c.plant_key as string,
      totalCents: hit?.total ?? 0,
      entryCount: hit?.count ?? 0,
    };
  });

  const monthTotal = plants.reduce((sum, p) => sum + p.totalCents, 0);

  const planted = plants.filter((p) => p.totalCents > 0).length;

  return (
    <section className="flex flex-col gap-7">
      {/* The bed is the hero — it is the most characteristic thing this app
          has, so it is what you land on, not a summary panel above it. */}
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[2.125rem] leading-[1.1] font-semibold text-ink sm:text-[2.5rem]">
          {monthLabel(month)}
        </h1>
        <p className="max-w-[64ch] text-sm text-ink-soft">
          {planted === 0 ? (
            <>
              Nothing planted yet. Say what you spent and the bed starts
              filling in.
            </>
          ) : (
            <>
              <span className="tnum text-ink">{formatCents(monthTotal)}</span>{" "}
              spent so far, growing {planted} of {plants.length} plants. The bed
              goes back to seed when the month turns.
            </>
          )}
        </p>
      </header>

      {plants.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No active categories — check the categories table.
        </p>
      ) : (
        <Garden plants={plants} />
      )}

      {/* Directly under the bed: you type here, the ground above responds. */}
      <div className="border-t border-rule pt-6">
        <LogExpense
          action={logExpenseFromText}
          modelLabel={formatModelSlug(PARSE_MODEL)}
          modelSlug={PARSE_MODEL}
        />
        <p className="mt-3 text-xs text-ink-faint">
          Prefer a form?{" "}
          <Link
            href="/expenses"
            className="text-ink-soft underline decoration-rule underline-offset-2 hover:text-ink"
          >
            Every entry is on the expenses page
          </Link>
          , where you can edit or delete one.
        </p>
      </div>
    </section>
  );
}
