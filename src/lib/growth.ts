/**
 * Plant growth (§A.6, §D.5).
 *
 * Growth is PRESENTATION LOGIC. It lives here as a pure function of a number
 * the database computed, and it is never stored, cached, or written back.
 *
 * A `growth_level` column would be worse than redundant — it would be a
 * client-writable field on a user-owned row, so any user could PATCH their
 * plant to full size and the garden would stop reflecting real spending. It
 * would also drift the moment an expense is edited or deleted, and it would
 * turn the monthly reset into a scheduled job that can fail. Derived per month,
 * the reset is just an empty group.
 */

export const MAX_STAGE = 5;

/**
 * Spending that counts as a fully grown plant for one month.
 *
 * A presentation constant, not a budget: it only decides how fast a plant
 * looks like it is growing. At 10000 cents, each 20.00 spent is one stage.
 * If per-category budgets are ever added, this is what they'd replace.
 */
export const FULL_GROWTH_CENTS = 10_000;

/** 0 (dormant) through 5 (fully grown), derived fresh on every render. */
export function growthStage(
  totalCents: number,
  targetCents: number = FULL_GROWTH_CENTS,
): number {
  if (totalCents <= 0 || targetCents <= 0) return 0;
  return Math.min(MAX_STAGE, Math.floor((totalCents / targetCents) * MAX_STAGE));
}
