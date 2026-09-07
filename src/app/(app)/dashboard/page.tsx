import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentMonthFor, monthLabel } from "@/lib/month";
import { formatCents } from "@/lib/money";
import { Garden, type Plant } from "./garden";
import { logExpenseFromText } from "../expenses/ai-actions";
import { LogExpense } from "../expenses/log-expense";

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
        <h1 className="text-xl font-semibold">Garden</h1>
        <p role="alert" className="text-red-700">
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

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Garden · {monthLabel(month)}</h1>
        <p className="text-sm text-zinc-500">
          {formatCents(monthTotal)} spent this month across {plants.length}{" "}
          categories. Plants renew each month.{" "}
          <Link href="/expenses" className="underline">
            Add an expense
          </Link>{" "}
          to water one.
        </p>
      </div>

      <LogExpense action={logExpenseFromText} />

      {plants.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No active categories — check the categories table.
        </p>
      ) : (
        <Garden plants={plants} />
      )}
    </section>
  );
}
