/**
 * The office-attendance policy, as one function.
 *
 * This is a deliberate mirror of `"mission-hq".member_metrics()` (migrations 13,
 * 18, 48, 49) and the day weights in migration 12. The fortnightly Slack report
 * computes from that SQL; every screen here computes from this file. There must
 * be ONE answer to "am I compliant", not one per surface.
 *
 * AS OF MIGRATION 49 THE WFH ALLOWANCE IS ONE DAY PER CALENDAR WEEK, on any
 * weekday. Wednesday is the policy's default, not its condition: the swap rule
 * lets a member move it, so scoring only Wednesdays marked people absent for a
 * day the policy had already granted them. A SECOND day at home in the same
 * week is the miss.
 *
 * The cap is weekly and must be applied weekly, before anything is summed. A
 * period-wide percentage cannot tell "home every Friday" apart from "home twice
 * in one week and never again", and only the first follows the policy.
 *
 * If you change a weight or a rule here, change it in the SQL in the same
 * commit, and vice versa.
 */

/**
 * How a status divides one day. Copied from migration 12; every row sums to 1,
 * so a half day scores as half of itself rather than silently as a whole one.
 *
 * Compensatory WFH weighs as OFFICE: it is comp for weekend work, not a WFH
 * choice. Travel, Client Location and Office + Client likewise.
 */
export const DAY_WEIGHTS: Record<string, { wfo: number; wfh: number; wfa: number; leave: number }> = {
  "Office":                { wfo: 1,   wfh: 0,   wfa: 0, leave: 0 },
  "Client Location":       { wfo: 1,   wfh: 0,   wfa: 0, leave: 0 },
  "Travel":                { wfo: 1,   wfh: 0,   wfa: 0, leave: 0 },
  "Office + Client":       { wfo: 1,   wfh: 0,   wfa: 0, leave: 0 },
  "Compensatory WFH":      { wfo: 1,   wfh: 0,   wfa: 0, leave: 0 },
  "Home":                  { wfo: 0,   wfh: 1,   wfa: 0, leave: 0 },
  "Anywhere":              { wfo: 0,   wfh: 0,   wfa: 1, leave: 0 },
  "Leave":                 { wfo: 0,   wfh: 0,   wfa: 0, leave: 1 },
  "Split Day":             { wfo: 0.5, wfh: 0.5, wfa: 0, leave: 0 },
  "Half Day Office Leave": { wfo: 0.5, wfh: 0,   wfa: 0, leave: 0.5 },
  "Half Day WFH Leave":    { wfo: 0,   wfh: 0.5, wfa: 0, leave: 0.5 },
};

/** Half days make every counter fractional, so never compare with `===`. */
const EPSILON = 0.001;

/** One day at home per calendar week, whichever weekday it falls on. */
const WFH_DAYS_PER_WEEK = 1;

/** Monday of the calendar week `date` falls in, as yyyy-MM-dd. The allowance is
 *  granted per week, so days have to be bucketed before they are summed. */
function weekKey(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (iso - 1));
  return d.toISOString().slice(0, 10);
}

export interface PeriodScore {
  /** Days we actually asked about. A date with no row is "never asked" and is
   *  not in the denominator; a row saying 'Pending' is "asked and ignored" and
   *  is. Conflating the two once dragged a whole team to the bottom of a
   *  published ranking. */
  prompted: number;
  /** prompted - leave - WFA. Days the person could have been in an office. */
  available: number;
  /** Office days. WFH does not contribute on any weekday (49). */
  adherent: number;
  /** WFH beyond the one-day-a-week allowance. This is the miss: it stays in
   *  the denominator and out of the numerator. */
  wfhExcess: number;
  wfo: number;
  wfh: number;
  wfa: number;
  /** The part of `wfa` that fell within the annual allowance, and so left the
   *  denominator. Equals `wfa` when no allowance was supplied. */
  wfaWithin: number;
  leave: number;
  /** Asked, never answered. */
  pending: number;
  /** adherent / available, 0-100. Null when nothing was available — somebody on
   *  leave all week has no rate, and showing them 0% would be a lie. */
  pct: number | null;
  /** Met the standard: every available day was either in the office or inside
   *  that week's single WFH day. */
  isCompliant: boolean;
}

/**
 * Score one person over one set of dates.
 *
 * `statuses` is the per-date map the dashboard payload already carries, and
 * `dates` is the window to score. Dates absent from `statuses` are dropped, so
 * holidays, weekends, days before someone joined and days nobody was prompted
 * on all fall out on their own — exactly as they do in the SQL, where
 * `prompted` is "how many attendance rows exist". That is why this file carries
 * no holiday list: a hardcoded one would need editing every January and would
 * disagree with the database the moment PnC moved a holiday.
 */
export interface Allowance {
  /** WFA days already spent this calendar year BEFORE the data window opens.
   *  The payload supplies it; the window itself cannot see January. */
  spentBeforeWindow: number;
  /** The annual allowance, from `settings.wfa_annual_cap`. */
  cap: number;
  /** Every date in the window, so WFA spent between the window opening and
   *  this period starting can be charged against the allowance first. */
  windowDates: string[];
  /** Jan 1 of the year the cap applies to. Dates before it are last year's
   *  allowance and must not be charged against this one. */
  yearStart: string;
}

/**
 * Consume the WFA allowance oldest-first, the way `member_metrics()` does.
 *
 * Days earlier in the year eat the allowance before this period does, so a
 * heavy user has none left by the time the period runs. Within entitlement WFA
 * is neutral like leave; beyond the cap it stays in the denominator and counts
 * as a check-in but not as office.
 *
 * Returns how much of this period's WFA is still within entitlement.
 */
function wfaWithinEntitlement(
  statuses: Record<string, string>,
  periodDates: string[],
  periodWfa: number,
  allowance: Allowance,
): number {
  const inPeriod = new Set(periodDates);
  const periodEnd = periodDates.length > 0 ? periodDates[periodDates.length - 1] : "";

  // WFA inside the window but before this period ended, excluding the period
  // itself — the SQL's `ytd - wfa_in_period`.
  let earlier = 0;
  for (const date of allowance.windowDates) {
    if (inPeriod.has(date)) continue;
    if (date < allowance.yearStart) continue; // last year's allowance
    if (date > periodEnd) continue;           // not yet spent
    const w = DAY_WEIGHTS[statuses[date] ?? ""];
    if (w) earlier += w.wfa;
  }

  const prior = Math.max(0, allowance.spentBeforeWindow + earlier);
  return Math.min(periodWfa, Math.max(0, allowance.cap - prior));
}

export function scorePeriod(
  statuses: Record<string, string>,
  dates: string[],
  /**
   * Omit it and all WFA is treated as neutral, which is what this screen did
   * before the allowance reached the payload. That is the lenient reading: it
   * lets somebody past the cap off, and it is why this parameter exists.
   */
  allowance?: Allowance,
): PeriodScore {
  let wfo = 0, wfh = 0, wfa = 0, leave = 0, pending = 0, prompted = 0;
  // WFH per calendar week, so the allowance can be capped week by week.
  const wfhByWeek = new Map<string, number>();

  for (const date of dates) {
    const status = statuses[date];
    if (!status) continue; // never asked — not this person's day to answer
    prompted++;

    const w = DAY_WEIGHTS[status];
    if (!w) {
      // 'Pending', or a status the Locations list no longer carries. Both mean
      // the same thing: a day that cannot be credited as presence.
      pending++;
      continue;
    }

    wfo += w.wfo;
    wfh += w.wfh;
    wfa += w.wfa;
    leave += w.leave;
    if (w.wfh > 0) {
      const k = weekKey(date);
      wfhByWeek.set(k, (wfhByWeek.get(k) ?? 0) + w.wfh);
    }
  }

  // WFA is neutral only within the annual allowance. Without the allowance
  // figures all of it is neutral; see the note on the parameter.
  const wfaWithin = allowance ? wfaWithinEntitlement(statuses, dates, wfa, allowance) : wfa;
  const available = prompted - leave - wfaWithin;
  // One day a week, whichever day it was. Capped per week BEFORE summing:
  // half days make these fractional, so two half-days at home in one week
  // consume the whole allowance.
  let wfhAllowed = 0, wfhExcess = 0;
  for (const inWeek of wfhByWeek.values()) {
    wfhAllowed += Math.min(inWeek, WFH_DAYS_PER_WEEK);
    wfhExcess  += Math.max(inWeek - WFH_DAYS_PER_WEEK, 0);
  }
  const adherent = wfo + wfhAllowed;

  return {
    prompted, available, adherent, wfhExcess,
    wfo, wfh, wfa, wfaWithin, leave, pending,
    pct: available > EPSILON ? Math.round((adherent / available) * 100) : null,
    isCompliant: available > EPSILON && adherent >= available - EPSILON,
  };
}

/**
 * Day counts are fractional because of half days. Print `4` not `4.0`, and
 * `3.5` not `3.4999999999999996`.
 */
export function fmtDays(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Was this a week somebody could actually have attended? Used to decide which
 * weeks belong in a rate. A window edge that clips a week to one day, or a week
 * spent entirely on leave, is not a week anybody failed.
 */
export function isRealWeek(availableDays: number): boolean {
  return availableDays >= 3;
}
