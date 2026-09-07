"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addMonths, currentMonthFor, todayFor } from "@/lib/month";
import { formatCents } from "@/lib/money";

/**
 * Chat over the user's own spending.
 *
 * THE OPENROUTER CALL HAPPENS IN THIS FILE AND NOWHERE ELSE (for this feature).
 * `process.env.OPENROUTER_API_KEY` is read only inside callOpenRouter() below.
 * This file carries "use server" on line 1, so none of it is bundled for the
 * browser; the client component receives only an action reference.
 *
 * Grounding: every figure in an answer comes from the three security_invoker
 * views, read as the signed-in user. RLS scopes them, so the numbers in the
 * prompt are that user's and no one else's — there is no user_id in any query
 * here, and none is passed to the model.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Sonnet 5 is the better fit for arithmetic over supplied numbers, but this
// OpenRouter workspace's guardrail blocks every Sonnet and Opus endpoint
// ("model-ignored-by-guardrail", HTTP 404 at the "Filter by Guardrails" routing
// step). Haiku 4.5 is the only Anthropic model the account can reach, so the
// system prompt compensates by requiring the figures used to be shown.
// The guardrail belongs to the school's workspace (the key is school-issued),
// so it is institutional policy, not a local setting - the configure_url in the
// 404 points at the viewer's own workspace and is misleading. If the allowlist
// ever admits Sonnet 5, change this back to "anthropic/claude-sonnet-5".
// Allowed alternatives today: google/gemini-2.5-flash, openai/gpt-5-mini.
const CHAT_MODEL = "anthropic/claude-haiku-4.5";

/** How much history to replay, so follow-ups resolve without unbounded cost. */
const HISTORY_TURNS = 10;
/** Grounding window. Twelve months covers "this year" and year-on-year asks. */
const WINDOW_MONTHS = 12;

export type ChatState = { error?: string };

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function callOpenRouter(
  messages: ChatMessage[],
): Promise<{ reply: string } | { error: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: "Chat is not configured on this server." };

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        // Pinned for the reason the parser taught us: OpenRouter will otherwise
        // route to an endpoint that advertises support for our parameters and
        // then quietly behaves differently.
        provider: { only: ["anthropic"] },
        max_tokens: 700,
        messages,
      }),
    });
  } catch {
    return { error: "Could not reach the AI service. Try again in a moment." };
  }

  // Read as text first: response.json() throws on a non-JSON body and takes the
  // body with it, leaving nothing to report.
  const rawBody = await response.text();

  if (!response.ok) {
    return {
      error: `The AI service returned an error (${response.status}). Try again in a moment.`,
    };
  }

  let envelope: {
    choices?: { message?: { content?: unknown } }[];
    error?: unknown;
  };
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return { error: "The AI service sent an unreadable response." };
  }

  // OpenRouter can return an error object inside a 200 response.
  if (envelope.error) {
    return { error: "The AI service reported an error. Try again in a moment." };
  }

  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    return { error: "The AI service sent an empty response." };
  }

  return { reply: content.trim() };
}

const SYSTEM_PROMPT = `You answer questions about one person's own spending and income.

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

export async function askAboutSpending(
  _prev: ChatState,
  formData: FormData,
): Promise<ChatState> {
  await requireUser();

  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { error: "Type a question first." };
  if (question.length > 1000) {
    return { error: "That question is too long. Shorten it." };
  }

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .maybeSingle();

  const today = todayFor(profile?.timezone);
  const windowStart = addMonths(currentMonthFor(profile?.timezone), -(WINDOW_MONTHS - 1));

  // Four reads, all aggregated in Postgres, all scoped by RLS. No .eq on
  // user_id anywhere: the views are security_invoker, so the filter is the
  // policy, not a predicate the client could influence.
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
      .order("created_at", { ascending: false })
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
    list.push({ label: labelFor.get(slug) ?? slug, cents: Number(r.total_cents) });
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
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content as string,
    }));

  const result = await callOpenRouter([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `DATA\n${dataBlock}` },
    ...priorTurns,
    { role: "user", content: question },
  ]);

  if ("error" in result) return result;

  // Both rows written together, only after a successful reply — so history
  // never holds a question with no answer. The table is append-only, so an
  // orphan could not be cleaned up later.
  const { error: insertError } = await supabase.from("messages").insert([
    { role: "user", content: question },
    { role: "assistant", content: result.reply },
  ]);
  if (insertError) return { error: insertError.message };

  revalidatePath("/chat");
  return {};
}
