// ===========================================================================
// Which fortnight does a run on this date report on?
//
// Two NON-OVERLAPPING halves, each finished before it is reported:
//
//   run on the 16th -> 1st..15th of this month
//   run on the 1st  -> 16th..end of last month
//
// Neither period contains the day the run happens on. That is deliberate and
// was learned the hard way: an earlier design had the 1st report a whole month,
// so 1-15 was counted twice, the two reports covered unequal spans which made
// per-person deltas meaningless, and a 10:00 run on the 15th counted that
// morning's still-Pending column against everybody.
//
// Month end is day 0 of the following month, so 28/29/30/31-day months and year
// rollovers need no special case.
// ===========================================================================

export type Period = { from: string; to: string; label: string; key: string };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** IST date parts for "now", because the whole calendar here is Indian. */
export function istParts(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() };
}

/**
 * The period a run today reports on, or null if today is neither the 1st nor
 * the 16th.
 *
 * Returning null rather than throwing is what lets this be scheduled DAILY. A
 * once-a-month cron that misses its slot misses the month in silence; one that
 * wakes every morning and decides not to fire cannot. That pattern is taken
 * from resolve-os's monthly report, for the same reason.
 */
export function periodFor(now = new Date()): Period | null {
  const { y, m, d } = istParts(now);

  if (d === 16) {
    return {
      from: iso(y, m, 1),
      to: iso(y, m, 15),
      label: `1-15 ${MONTHS[m]} ${y}`,
      key: `${iso(y, m, 1)}..${iso(y, m, 15)}`,
    };
  }

  if (d === 1) {
    // Day 0 of this month is the last day of the previous one.
    const prev = new Date(Date.UTC(y, m, 0));
    const py = prev.getUTCFullYear();
    const pm = prev.getUTCMonth();
    const end = prev.getUTCDate();
    return {
      from: iso(py, pm, 16),
      to: iso(py, pm, end),
      label: `16-${end} ${MONTHS[pm]} ${py}`,
      key: `${iso(py, pm, 16)}..${iso(py, pm, end)}`,
    };
  }

  return null;
}

/** "our sixth attendance snapshot". Past twenty it just reads as a number. */
export function ordinal(n: number): string {
  const words = [
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
    "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth",
    "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
  ];
  return words[n - 1] || `${n}th`;
}
