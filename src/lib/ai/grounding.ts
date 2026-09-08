import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonths, currentMonthFor, todayFor } from "@/lib/month";
import { formatCents } from "@/lib/money";

/**
 * Grounding for the chat feature: the DATA block and the replayed history.
 *
 * Extracted from the old server action so the streaming Route Handler and any
 * future caller build the same context from the same code. Holds no secret and
 * makes no model call — it only reads the user's own aggregates.
 *
 * Server-only by usage: imported exclusively by the Route Handler. It is never
 * imported by a client component, and nothing here would be useful there.
 */

/** How much history to replay, so follow-ups resolve without unbounded cost. */
export const HISTORY_TURNS = 10;
/** Grounding window. Twelve months covers "this year" and year-on-year asks. */
export const WINDOW_MONTHS = 12;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const SYSTEM_PROMPT = `You answer questions about one person's own spending and income.

Rules, in order of importance:
1. Use ONLY the figures in the DATA block. Never invent, estimate, extrapolate, or recall a number from anywhere else.
2. Answer ONLY the question in the current user message. Earlier turns are context for resolving references and follow-ups — for example, working out what "that category" or "and compared to my income?" refers to. They are never a reason to re-answer, restate, or summarise a question that was already answered. If the current message asks one thing, your reply covers that one thing and stops.
3. If the DATA block does not contain what the question needs, say so plainly and name what is missing (for example: "there is no income recorded for July"). Do not approximate instead, and do not fill the gap by talking about a different month or category the user did not ask about.
4. Arithmetic on the supplied numbers is allowed and expected — sums, differences, comparisons, which category is largest. Show the figures you used.
5. Amounts are in the app's single currency, written in major units with two decimals. Keep that format.
6. Be brief: two or three sentences, or a short list when comparing categories. Do not use section headings, bold labels, or a multi-part structure unless the single current question genuinely has multiple parts.
7. Do not mention the DATA block, the database, or how the numbers reached you. Just answer.`;

/**
 * Aggregated totals only — never raw expense rows. The prompt leaves our
 * infrastructure, so it carries the smallest set of numbers that can answer a
 * question about spending, and no identifiers at all.
 */
function buildDataBlock(
  today: string,
  months: string[],
  income: Map<string, number>,
  expense: Map<string, number>,
  byCategory: Map<string, { label: string; cents: number }[]>,
  categoryLabels: string[],
): string {
  const lines: string[] = [`Today is ${today}.`, ""];

  lines.push("Monthly totals (income, expenses, net):");
  if (months.length === 0) {
    lines.push("  (no income or expenses recorded)");
  } else {
    for (const month of months) {
      const inc = income.get(month) ?? 0;
      const exp = expense.get(month) ?? 0;
      lines.push(
        `  ${month.slice(0, 7)}  income ${formatCents(inc)}  expenses ${formatCents(exp)}  net ${formatCents(inc - exp)}`,
      );
    }
  }

  lines.push("", "Spending by category, per month:");
  const catMonths = months.filter((m) => (byCategory.get(m) ?? []).length > 0);
  if (catMonths.length === 0) {
    lines.push("  (no expenses recorded)");
  } else {
    for (const month of catMonths) {
      const parts = (byCategory.get(month) ?? [])
        .map((c) => `${c.label} ${formatCents(c.cents)}`)
        .join(", ");
      lines.push(`  ${month.slice(0, 7)}  ${parts}`);
    }
  }

  lines.push(
    "",
    `Categories that exist in this app: ${categoryLabels.join(", ")}.`,
    "A category absent from a month means nothing was spent on it that month.",
    `This covers the last ${WINDOW_MONTHS} months only.`,
  );

  return lines.join("\n");
}

/**
 * Reads the three security_invoker views plus the category list and recent
 * history, and assembles the message array for the model.
 *
 * There is no `.eq('user_id', ...)` in any query here. RLS supplies that
 * predicate inside the views, so the numbers are the caller's own and no
 * user id is ever passed to the model.
 */
export async function buildChatMessages(
  supabase: SupabaseClient,
  question: string,
): Promise<{ messages: ChatMessage[] } | { error: string }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .maybeSingle();

  const today = todayFor(profile?.timezone);
  const windowStart = addMonths(
    currentMonthFor(profile?.timezone),
    -(WINDOW_MONTHS - 1),
  );

  const [
    { data: incomeRows, error: incomeError },
    { data: expenseRows, error: expenseError },
    { data: categoryRows, error: categoryError },
    { data: categories, error: catListError },
    { data: history, error: historyError },
  ] = await Promise.all([
    supabase
      .from("v_month_income_totals")
      .select("month, total_cents")
      .gte("month", windowStart)
      .order("month", { ascending: false }),
    supabase
      .from("v_month_expense_totals")
      .select("month, total_cents")
      .gte("month", windowStart)
      .order("month", { ascending: false }),
    supabase
      .from("v_category_month_totals")
      .select("month, category_slug, total_cents")
      .gte("month", windowStart)
      .order("month", { ascending: false }),
    supabase
      .from("categories")
      .select("slug, label")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("messages")
      .select("role, content")
      // seq, not created_at: a pair shares its created_at, so created_at could
      // hand the model an answer before the question it answered.
      .order("seq", { ascending: false })
      .limit(HISTORY_TURNS),
  ]);

  const readError =
    incomeError ?? expenseError ?? categoryError ?? catListError ?? historyError;
  if (readError) return { error: readError.message };

  const labelFor = new Map(
    (categories ?? []).map((c) => [c.slug as string, c.label as string]),
  );

  const income = new Map<string, number>();
  for (const r of incomeRows ?? []) {
    income.set(r.month as string, Number(r.total_cents));
  }
  const expense = new Map<string, number>();
  for (const r of expenseRows ?? []) {
    expense.set(r.month as string, Number(r.total_cents));
  }
  const byCategory = new Map<string, { label: string; cents: number }[]>();
  for (const r of categoryRows ?? []) {
    const month = r.month as string;
    const slug = r.category_slug as string;
    const list = byCategory.get(month) ?? [];
    list.push({
      label: labelFor.get(slug) ?? slug,
      cents: Number(r.total_cents),
    });
    byCategory.set(month, list);
  }

  const months = [
    ...new Set([...income.keys(), ...expense.keys(), ...byCategory.keys()]),
  ].sort((a, b) => (a < b ? 1 : -1));

  const dataBlock = buildDataBlock(
    today,
    months,
    income,
    expense,
    byCategory,
    (categories ?? []).map((c) => c.label as string),
  );

  // History arrives newest-first from the index; the model needs oldest-first.
  const priorTurns: ChatMessage[] = (history ?? [])
    .slice()
    .reverse()
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content as string,
    }));

  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `DATA\n${dataBlock}` },
      ...priorTurns,
      { role: "user", content: question },
    ],
  };
}
