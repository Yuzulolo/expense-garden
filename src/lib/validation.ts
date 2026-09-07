import { MAX_AMOUNT_CENTS, toCents } from "@/lib/money";

/**
 * Server-side validation for every mutation.
 *
 * These mirror the CHECK constraints in the migrations; they exist for readable
 * error messages, not for enforcement. The database is the enforcement, because
 * PostgREST is reachable with the anon key and never sees this file (§D.10).
 * Where the two disagree, the database is right.
 *
 * §C names zod for this module. Written by hand here to avoid adding a
 * dependency for four fields; the shapes are small enough to check directly.
 */

/** The `occurred_on >= date '2000-01-01'` CHECK. */
const MIN_DATE = "2000-01-01";

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ExpenseInput = {
  category_slug: string;
  amount_cents: number;
  description: string | null;
  occurred_on: string;
};

export type IncomeInput = {
  source: string;
  amount_cents: number;
  description: string | null;
  occurred_on: string;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function parseAmount(raw: string): Parsed<number> {
  if (!raw) return { ok: false, error: "Enter an amount." };

  const cents = toCents(raw);
  if (cents === null) {
    return { ok: false, error: "Amount must be a number like 12.34." };
  }
  if (cents <= 0) return { ok: false, error: "Amount must be more than zero." };
  if (cents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: "That amount is implausibly large." };
  }
  return { ok: true, value: cents };
}

function parseDate(raw: string): Parsed<string> {
  if (!raw) return { ok: false, error: "Pick a date." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, error: "Date must be in YYYY-MM-DD form." };
  }
  if (raw < MIN_DATE) {
    return { ok: false, error: `Date must be on or after ${MIN_DATE}.` };
  }
  return { ok: true, value: raw };
}

function parseDescription(raw: string): Parsed<string | null> {
  if (raw.length > 280) {
    return { ok: false, error: "Description is limited to 280 characters." };
  }
  return { ok: true, value: raw === "" ? null : raw };
}

/** An id supplied by the client says WHICH row to act on — never who owns it. */
export function parseId(formData: FormData): Parsed<string> {
  const id = field(formData, "id");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) return { ok: false, error: "That entry id is not valid." };
  return { ok: true, value: id };
}

export function parseExpense(formData: FormData): Parsed<ExpenseInput> {
  const category_slug = field(formData, "category_slug");
  if (!category_slug) return { ok: false, error: "Choose a category." };
  // No list check here on purpose: the FK to public.categories rejects an
  // unknown slug at the database, which is the check that actually holds.

  const amount = parseAmount(field(formData, "amount"));
  if (!amount.ok) return amount;

  const occurred_on = parseDate(field(formData, "occurred_on"));
  if (!occurred_on.ok) return occurred_on;

  const description = parseDescription(field(formData, "description"));
  if (!description.ok) return description;

  return {
    ok: true,
    value: {
      category_slug,
      amount_cents: amount.value,
      description: description.value,
      occurred_on: occurred_on.value,
    },
  };
}

export function parseIncome(formData: FormData): Parsed<IncomeInput> {
  const source = field(formData, "source");
  if (!source) return { ok: false, error: "Enter a source." };
  if (source.length > 80) {
    return { ok: false, error: "Source is limited to 80 characters." };
  }

  const amount = parseAmount(field(formData, "amount"));
  if (!amount.ok) return amount;

  const occurred_on = parseDate(field(formData, "occurred_on"));
  if (!occurred_on.ok) return occurred_on;

  const description = parseDescription(field(formData, "description"));
  if (!description.ok) return description;

  return {
    ok: true,
    value: {
      source,
      amount_cents: amount.value,
      description: description.value,
      occurred_on: occurred_on.value,
    },
  };
}
