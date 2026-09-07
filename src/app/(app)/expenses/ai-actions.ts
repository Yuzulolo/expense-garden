"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayFor } from "@/lib/month";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { createExpense, type ActionState } from "./actions";
import { PARSE_MODEL } from "@/lib/ai/models";

/**
 * Natural-language expense logging — the app's primary input method.
 *
 * THE OPENROUTER CALL HAPPENS IN THIS FILE AND NOWHERE ELSE.
 * `process.env.OPENROUTER_API_KEY` is read only inside callOpenRouter() below.
 * This file carries "use server" at the top, so nothing in it is ever bundled
 * for the browser; the key cannot reach a client component because no client
 * component imports anything from here except the exported action reference,
 * which the compiler replaces with an action id.
 *
 * The insert itself is delegated to createExpense() from ./actions — the exact
 * same server action the manual form posts to. There is deliberately no second
 * insert path: same validation, same `default auth.uid()`, same RLS policies,
 * same revalidation.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ParsedExpense = {
  amount: number | null;
  category_slug: string | null;
  description: string | null;
  date: string | null;
};

/**
 * One call to OpenRouter. Returns the raw parsed object, or null if the model
 * or the network failed — callers must not treat null as "no amount".
 */
async function callOpenRouter(
  utterance: string,
  slugs: string[],
  today: string,
): Promise<{ parsed: ParsedExpense } | { error: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return { error: "AI logging is not configured on this server." };
  }

  // The enum is built from the rows we just read, so the model is offered the
  // real category set rather than a hardcoded copy that could drift.
  // Nullable fields use `anyOf`, NOT `type: ["string", "null"]`. Anthropic's
  // structured-output validator rejects a union type array combined with an
  // enum outright: `Enum value 'social' does not match declared type
  // '['string','null']'`. anyOf is the form it accepts.
  const schema = {
    type: "object",
    properties: {
      amount: {
        anyOf: [{ type: "number" }, { type: "null" }],
        description:
          "The amount spent, in major currency units (12.5 means twelve fifty). Null if the text contains no amount.",
      },
      category_slug: {
        anyOf: [{ type: "string", enum: slugs }, { type: "null" }],
        description: "The best-fitting category, or null if none clearly fits.",
      },
      description: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description:
          "A short description of what was bought, without the amount. Null if there is nothing to say.",
      },
      date: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: `The date as YYYY-MM-DD. Today is ${today}. Resolve relative dates like "yesterday" against it. Null if the text gives no date.`,
      },
    },
    required: ["amount", "category_slug", "description", "date"],
    additionalProperties: false,
  };

  const requestBody = {
    model: PARSE_MODEL,
    // require_parameters alone is NOT enough: it filters on a provider's
    // ADVERTISED parameter support, and OpenRouter's Azure endpoint for this
    // model advertises response_format while ignoring json_schema - it returns
    // markdown-fenced prose with invented field names, which fails JSON.parse.
    // Pinning to Anthropic is what actually enforces the schema.
    provider: { require_parameters: true, only: ["anthropic"] },
    response_format: {
      type: "json_schema",
      json_schema: { name: "expense", strict: true, schema },
    },
    messages: [
      {
        role: "system",
        content:
          "You extract a single expense from a short note a person typed. Report only what the text says. If the text does not state an amount, return null for amount — never guess or infer one. If no category clearly fits, return null rather than picking the closest.",
      },
      { role: "user", content: utterance },
    ],
  };

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return { error: "Could not reach the AI service. Try again in a moment." };
  }

  // Read as TEXT first: response.json() throws on a non-JSON body and we lose
  // the very thing we need to see.
  const rawBody = await response.text();

  if (!response.ok) {
    return {
      error: `The AI service returned an error (${response.status}). Try again, or enter it manually.`,
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
    return { error: "The AI service reported an error. Try again, or enter it manually." };
  }

  const content = envelope.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    return { error: "The AI service sent an unreadable response." };
  }

  try {
    return { parsed: JSON.parse(content) as ParsedExpense };
  } catch {
    // A schema was requested, but a schema is a request, not a guarantee.
    return { error: "Could not read that. Try rephrasing, or enter it manually." };
  }
}

export async function logExpenseFromText(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const utterance = String(formData.get("utterance") ?? "").trim();
  if (!utterance) {
    return { error: "Type what you spent, e.g. “spent 12 on coffee with Sam”." };
  }
  if (utterance.length > 500) {
    return { error: "That is longer than a single expense note. Shorten it." };
  }

  const supabase = await createClient();

  // The real category set, read under RLS, used both to prompt the model and to
  // validate what comes back.
  const [{ data: categories, error: categoriesError }, { data: profile }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("slug")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("profiles").select("timezone").maybeSingle(),
    ]);

  if (categoriesError) return { error: categoriesError.message };

  const slugs = (categories ?? []).map((c) => c.slug as string);
  if (slugs.length === 0) {
    return { error: "No active categories are configured." };
  }

  const today = todayFor(profile?.timezone);
  const result = await callOpenRouter(utterance, slugs, today);
  if ("error" in result) return result;

  const { amount, category_slug, description, date } = result.parsed;

  // No amount: say so and stop. Never invent a number for a financial record.
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return {
      error:
        "Could not find an amount in that. Include one, e.g. “12 on coffee” — or enter it manually below.",
    };
  }
  if (Math.round(amount * 100) > MAX_AMOUNT_CENTS) {
    return { error: "That amount is implausibly large." };
  }

  // Invalid or missing slug: ask for a rephrase. Never coerce to a default
  // category — a silently miscategorised expense waters the wrong plant and
  // the user has no way to notice.
  if (typeof category_slug !== "string" || !slugs.includes(category_slug)) {
    return {
      error: `Could not tell which category that belongs to. Try naming it (${slugs.join(", ")}), or enter it manually below.`,
    };
  }

  // Date is the one field with a safe default: an expense you are logging now
  // happened today unless the text says otherwise.
  const occurredOn =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : today;

  // Hand off to the manual form's own action. Everything past this point —
  // validation, the absent user_id, RLS, revalidatePath — is shared code.
  const insert = new FormData();
  insert.set("category_slug", category_slug);
  insert.set("amount", amount.toFixed(2));
  insert.set("occurred_on", occurredOn);
  insert.set("description", (description ?? "").slice(0, 280));

  const inserted = await createExpense({}, insert);
  if (inserted.error) return inserted;

  return { message: `Logged ${amount.toFixed(2)} to ${category_slug}.` };
}
