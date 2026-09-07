/**
 * Month helpers (§A.8).
 *
 * A month is a `date` pinned to the 1st ("2026-09-01"), never the string
 * "2026-9" — text months sort wrong across year boundaries and can't be
 * range-queried. Every month calculation in the app goes through this file, so
 * an off-by-one-month bug in a financial record has one place to be fixed.
 */

/** First of the month containing an ISO date string. */
export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** First of the following month — the exclusive upper bound of a range query. */
export function nextMonth(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/**
 * Which month is "now" for this user — the only timezone-sensitive computation
 * in the app, and the reason profiles.timezone exists.
 *
 * Never `new Date().getMonth()` in the browser: a user in UTC+13 would see the
 * next month's (empty) garden a day early. Computed here on the server from the
 * user's stored IANA zone, falling back to UTC for an unset or invalid one.
 */
export function currentMonthFor(timezone: string | null | undefined): string {
  return startOfMonth(todayFor(timezone));
}

/**
 * Today's calendar date in the user's zone, as YYYY-MM-DD.
 *
 * Same rule as currentMonthFor: computed on the server from the stored IANA
 * zone, never from the browser clock.
 */
export function todayFor(timezone: string | null | undefined): string {
  const zone = timezone || "UTC";
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly what we need.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // Intl throws RangeError on an unknown zone rather than falling back.
    return new Date().toISOString().slice(0, 10);
  }
}

/** Shift a first-of-month date by whole months (negative goes back). */
export function addMonths(monthStart: string, delta: number): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const zeroBased = year * 12 + (month - 1) + delta;
  const y = Math.floor(zeroBased / 12);
  const m = (zeroBased % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** "2026-09-01" -> "September 2026", for display only. */
export function monthLabel(monthStart: string): string {
  const [year, month] = monthStart.split("-");
  const name = new Intl.DateTimeFormat("en", { month: "long" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
  return `${name} ${year}`;
}
