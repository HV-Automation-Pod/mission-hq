/**
 * Shared HyperVerge work calendar — the ONE place the company holiday list lives.
 *
 * This project is published as an Apps Script **library** (script id
 * `1rfcF-KeUDthKpZ2kmXkefHXa0fAYzWrOuO-tTAs702ZhUVpxPXICa-uH`). Every other
 * automation that needs to know "is today a working day?" pins that library and
 * calls through it instead of keeping its own copy of the holiday array:
 *
 *   MissionHQ.isWeekend()               // today, or pass a date
 *   MissionHQ.isHoliday()               // today, or pass a date
 *   MissionHQ.isBusinessDay(date)       // neither weekend nor holiday
 *   MissionHQ.rollToBusinessDay(date)   // date, or the next working day after it
 *   MissionHQ.addBusinessDays(date, 2)  // 2 working days later
 *   MissionHQ.getHolidays()             // the raw "MM/DD" list
 *
 * Dependants pin the library with `developmentMode: true`, so they run whatever
 * is at HEAD here. **Updating the holidays for a new year is a single edit to
 * hvHolidays_() below** — no dependant needs a redeploy or a version bump.
 *
 * Callers inside THIS project just call isWeekend() / isHoliday() directly.
 */

/**
 * The year hvHolidays_() was last curated for. Indian holidays largely move
 * every year (Holi, Eid, Diwali, Dussehra…), so a list left over from a
 * previous year is silently wrong rather than obviously wrong — bump this
 * whenever you refresh the list and hvWarnStaleHolidayList_() stops nagging.
 */
var HV_HOLIDAY_YEAR = 2026;

/**
 * Company holidays as "MM/DD" strings in Asia/Kolkata. Year-less on purpose:
 * the list is replaced wholesale once a year (see HV_HOLIDAY_YEAR).
 *
 * A function rather than a top-level const because Apps Script libraries only
 * expose *functions* to their callers — a `const` here would be invisible as
 * `MissionHQ.HV_HOLIDAYS`.
 */
function hvHolidays_() {
  return [
    "01/01", // New Year's Day
    "01/15", // Pongal / Makar Sankranti
    "01/26", // Republic Day
    "03/04",
    "03/20",
    "03/31",
    "04/03",
    "05/01", // May Day
    "08/15", // Independence Day
    "10/02", // Gandhi Jayanti
    "11/01", // Kannada Rajyotsava
    "11/09",
    "11/10",
    "12/25"  // Christmas
  ];
}

/** The holiday list, as a copy — mutating the result cannot corrupt the source. */
function getHolidays() {
  return hvHolidays_().slice();
}

/** The year the holiday list was curated for. */
function getHolidayYear() {
  return HV_HOLIDAY_YEAR;
}

// ---------------------------------------------------------------------------
// Public predicates
// ---------------------------------------------------------------------------

/**
 * Is the given date (default: today) a Saturday or Sunday?
 * @param {Date|string} [date]
 * @return {boolean}
 */
function isWeekend(date) {
  const d = hvResolveDate_(date);
  const weekend = hvIsWeekend_(d);
  console.log(`${hvDateLabel_(d)} is ${weekend ? "" : "not "}a weekend day.`);
  return weekend;
}

/**
 * Is the given date (default: today) a company holiday?
 * @param {Date|string} [date]
 * @return {boolean}
 */
function isHoliday(date) {
  const d = hvResolveDate_(date);
  const holiday = hvIsHoliday_(d);
  console.log(`${hvDateLabel_(d)} is ${holiday ? "" : "not "}a holiday.`);
  return holiday;
}

/**
 * A working day — neither weekend nor holiday. Quiet: safe to call in a loop,
 * unlike isWeekend()/isHoliday(), which log on every call.
 * @param {Date|string} date
 * @return {boolean}
 */
function isBusinessDay(date) {
  const d = hvResolveDate_(date);
  return !hvIsWeekend_(d) && !hvIsHoliday_(d);
}

/**
 * The date itself if it is a working day, otherwise the next working day after
 * it. Use this to move a calendar-day deadline off a weekend or holiday.
 * @param {Date|string} date
 * @return {Date} midnight on the resolved working day
 */
function rollToBusinessDay(date) {
  let d = hvStartOfDay_(hvResolveDate_(date));
  for (let guard = 0; guard <= 30; guard++) {
    if (isBusinessDay(d)) return d;
    d = hvAddDays_(d, 1);
  }
  // Only reachable if the holiday list has grown absurd — better to fail loudly
  // than to hand back a date 30+ days off the one that was asked for.
  throw new Error(`rollToBusinessDay: no working day within 30 days of ${hvDateLabel_(hvResolveDate_(date))} — check the holiday list.`);
}

/**
 * `count` working days after `date`, counting weekends and holidays as zero.
 *
 * The start date is never counted, so a Monday + 2 is Wednesday, and a Friday
 * + 2 is the following Tuesday (Monday is only the first working day). With
 * count = 0 the input is returned unchanged even if it is a weekend — use
 * rollToBusinessDay() if you want it moved.
 *
 * @param {Date|string} date
 * @param {number} count whole number of working days, >= 0
 * @return {Date} midnight on the resulting day
 */
function addBusinessDays(date, count) {
  const n = Number(count);
  if (!isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error(`addBusinessDays: count must be a whole number >= 0, got "${count}".`);
  }

  let d = hvStartOfDay_(hvResolveDate_(date));
  let remaining = n;
  let guard = 0;
  while (remaining > 0) {
    d = hvAddDays_(d, 1);
    if (isBusinessDay(d)) remaining--;
    if (++guard > 400) {
      throw new Error(`addBusinessDays: could not find ${n} working day(s) within 400 days — check the holiday list.`);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Quiet weekend test — no logging, so loops stay readable. */
function hvIsWeekend_(d) {
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

/** Quiet holiday test — no logging. */
function hvIsHoliday_(d) {
  hvWarnStaleHolidayList_();
  return hvHolidays_().indexOf(hvMonthDay_(d)) !== -1;
}

/**
 * Accepts a Date, a date string, or nothing (meaning today). Dates are used
 * as-is: every dependant runs in Asia/Kolkata, so the plain getters below are
 * already in the right zone.
 */
function hvResolveDate_(date) {
  if (date === undefined || date === null || date === "") return new Date();

  if (Object.prototype.toString.call(date) === "[object Date]") {
    if (isNaN(date.getTime())) throw new Error("Work calendar: an Invalid Date was passed in.");
    return date;
  }

  const raw = date.toString().trim();
  // Built from parts so it lands at local midnight — new Date("2026-08-10") is
  // parsed as UTC and can slip a day.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) throw new Error(`Work calendar: cannot read "${raw}" as a date.`);
  return parsed;
}

function hvStartOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Day arithmetic via the Date constructor, so month ends and DST are handled. */
function hvAddDays_(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function hvMonthDay_(d) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function hvDateLabel_(d) {
  return `${d.getFullYear()}-${hvMonthDay_(d).replace("/", "-")}`;
}

/**
 * Warns once per execution when the calendar year has moved past the year the
 * holiday list was written for. Without this, a forgotten yearly update fails
 * silently — automations quietly treat real holidays as working days.
 */
var hvHolidayYearWarned_ = false;
function hvWarnStaleHolidayList_() {
  if (hvHolidayYearWarned_) return;
  hvHolidayYearWarned_ = true;

  const thisYear = new Date().getFullYear();
  if (thisYear !== HV_HOLIDAY_YEAR) {
    console.log(
      `⚠️ Work calendar: the holiday list was curated for ${HV_HOLIDAY_YEAR} but it is now ${thisYear}. ` +
      `Most Indian holidays move every year — update hvHolidays_() and HV_HOLIDAY_YEAR in the MissionHQ library (WorkCalendar.js).`
    );
  }
}
