/**
 * Money is stored as integer minor units (`amount_cents bigint`), never a float
 * and never a decimal string (§A.7). These two functions are the only place a
 * raw cents value is converted; nothing else should do arithmetic on it.
 */

/** The `amount_cents <= 100000000000` CHECK on expenses and incomes. */
export const MAX_AMOUNT_CENTS = 100_000_000_000;

/**
 * Parse user input ("12", "12.3", "12.34", "12,34") into integer cents.
 * Returns null for anything else — including "1e5", "-5", "abc" and NaN, all of
 * which parseFloat would happily accept.
 */
export function toCents(input: string): number | null {
  const normalised = input.trim().replace(",", ".");
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(normalised)) return null;

  const [whole, fraction = ""] = normalised.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(cents) ? cents : null;
}

/** Render cents for display. No currency symbol — the schema doesn't fix one. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const minor = String(absolute % 100).padStart(2, "0");
  return `${sign}${Math.floor(absolute / 100)}.${minor}`;
}

/** Cents back into the string an <input> should show for editing. */
export function centsToInput(cents: number): string {
  return formatCents(cents);
}
