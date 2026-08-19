// ---------------------------------------------------------------------------
// Fortnightly WFO attendance snapshots -> per-group Slack channels.
//
// sendScheduledSummaries() is the trigger handler. Point two monthly triggers
// at it, on the 1st and the 16th. Each reports the half-month that has just
// finished: the 16th covers the 1st-15th, the 1st covers the 16th to month end.
// The halves never overlap, and neither includes the day it runs on, so the
// trigger hour does not affect the numbers.
//
// Posted with the HV Automation bot (not the attendance bot) via
// HV_AUTOMATION_BOT_TOKEN. It holds chat:write.customize, so each channel gets
// its own display name through `username`. No icon_url / icon_emoji is sent, so
// the bot keeps its real avatar everywhere.
// ---------------------------------------------------------------------------

const SUMMARY_BOT_TOKEN_PROPERTY = "HV_AUTOMATION_BOT_TOKEN";

// Test runs post every group here instead of the real channels, and never write
// score/snapshot state. Read lazily — only test runs need it set.
const TEST_SUMMARY_CHANNEL_PROPERTY = "TEST_SUMMARY_CHANNEL_ID";

const SUMMARY_SIGN_OFF = "People & Culture";

// Per-group state, so deltas and the "nth snapshot" wording work without anyone
// pasting last fortnight's numbers in by hand. Only real sends update these —
// test and preview runs leave them alone.
const SUMMARY_SCORES_PROPERTY_PREFIX = "SUMMARY_SCORES_";
const SUMMARY_SNAPSHOT_PROPERTY_PREFIX = "SUMMARY_SNAPSHOT_";

// --- PMS master sheet (levels) ----------------------------------------------
// A separate spreadsheet holding compensation data. It is read ONLY by
// syncPmsLevelsToLog(), which copies the level value into the MissionHQ Log's
// own "PMS Level" column, matched by email. The scheduled runs read that column
// and never touch the PMS sheet.
const PMS_MASTER_SHEET_ID_PROPERTY = "PMS_MASTER_SHEET_ID";
const PMS_MASTER_TAB_NAME = "Master Sheet";
const PMS_HEADER_ROW = 2; // headers live in row 2, data starts at row 3
const PMS_EMAIL_COLUMNS = ["Email ID", "Email Address", "Email"];
// M1/M2/M3 live in the "PMS '26 Level" column — NOT "PMS '26 Rating", which
// holds the Consistently Meets / Often Exceeds text and is only a fallback in
// case the level values ever move there.
const PMS_LEVEL_COLUMNS = ["PMS '26 Level", "PMS '26 Rating", "PMS Level"];
const PMS_MANAGER_LEVEL_PATTERN = /^m\d+$/; // m1, m2, m3 ... after normalizing

// Column in the MissionHQ Log that the PMS sync writes into, and that the
// Managers group is matched against.
const PMS_LEVEL_COLUMN = "PMS Level";

// --- FLG roster tab ----------------------------------------------------------
// FLG is not a Zoho department — its members sit across several departments, so
// the Log's Department column (which tracks Zoho, see SyncEmployees.js) can
// never name them. The membership list is instead maintained by hand on the
// "FLG" tab of this same spreadsheet, one row per person with an
// "Email Address" column, and joined to the Log by email.
const FLG_ROSTER_SHEET_NAME = "FLG";
const SUMMARY_ROSTER_EMAIL_COLUMNS = ["Email Address", "Email ID", "Email"];

// --- Groups ------------------------------------------------------------------
// column matcher: the sheet cell is split on commas, so a Department of
// "Finance, FLG" belongs to both the FLG group and the G&A group.
// roster matcher: membership comes from a separate tab's email column.
const SUMMARY_GROUPS = [
  {
    key: "coimbatore",
    title: "Coimbatore",
    channelId: "C046Y1LKZLG",
    botName: "Coimbatore Attendance Summary",
    match: { type: "column", column: "Location", values: ["Coimbatore"] }
  },
  {
    key: "flg",
    title: "FLG",
    channelId: "C07R3JUEL86",
    botName: "FLG Attendance Summary",
    match: { type: "roster", sheet: FLG_ROSTER_SHEET_NAME }
  },
  {
    key: "mumbai",
    title: "Mumbai",
    channelId: "C07CGSQF42U",
    botName: "Mumbai Attendance Summary",
    match: { type: "column", column: "Location", values: ["Mumbai"] }
  },
  {
    key: "bengaluru",
    title: "Bengaluru",
    channelId: "C08K2HXPCRG",
    botName: "Bengaluru Attendance Summary",
    match: { type: "column", column: "Location", values: ["Bengaluru"] }
  },
  {
    key: "gna",
    title: "G&A",
    channelId: "C0331D6JE2D",
    botName: "G&A Attendance Summary",
    match: {
      type: "column",
      column: "Department",
      values: ["People & Culture", "Finance", "Legal", "Admin"]
    }
  },
  {
    key: "managers",
    title: "Managers",
    channelId: "C061H34DECA",
    botName: "Managers Attendance Summary",
    match: { type: "columnPattern", column: PMS_LEVEL_COLUMN, pattern: PMS_MANAGER_LEVEL_PATTERN }
  }
];

// --- Metric definitions ------------------------------------------------------
// Matched after normalizing, so "Office + Client" == "office+client".
// Classification per People & Culture spec (Vani, 2026-08-10).
// WFA ("Anywhere") is tracked SEPARATELY from WFO/WFH — it is a capped annual
// entitlement (10 days/year), so it neither helps nor hurts office adherence.
const WFO_STATUSES = [
  "Office", "Client", "Client Location", "Split Day", "Travel",
  "Office + Client", "Compensatory WFH", "Half Day Office Leave"
];
const WFH_STATUSES = ["Home", "Half Day WFH Leave"];
const WFA_STATUSES = ["Anywhere"];
const LEAVE_STATUSES = ["Leave"];

// Each employee is entitled to at most this many WFA days per calendar year.
const WFA_ANNUAL_CAP = 10;
// Everything else — including a blank cell — counts as Pending: a day that
// cannot be credited as presence.

// Ranked by True WFO Adherence. D is "never checked in once" (0%).
const SUMMARY_TIERS = [
  { key: "S", min: 90, emoji: ":large_green_circle:", label: "Exceeding the standard — ≥90%" },
  { key: "A", min: 80, emoji: ":large_blue_circle:", label: "Meeting the standard — 80–89%" },
  { key: "B", min: 60, emoji: ":large_yellow_circle:", label: "Good progress — 60–79%" },
  { key: "C", min: 1, emoji: ":large_orange_circle:", label: "Needs attention — below 60%" },
  { key: "D", min: 0, emoji: ":red_circle:", label: "Check-in not active" }
];

// Movement thresholds for the delta annotations.
const SUMMARY_DELTA_BOLD_PP = 10;
const SUMMARY_DELTA_ARROW_PP = 15;

const SUMMARY_ORDINALS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
  "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth",
  "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"
];

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Trigger handler for both the 1st and the 16th. Picks the half from today's
 * date: on/after the 16th it reports the 1st-15th of this month, otherwise the
 * 16th to month end of last month.
 */
function sendScheduledSummaries() {
  try {
    const period = resolveSummaryPeriod_(new Date());
    Logger.log(`Scheduled summary run: ${period.label} (${period.start} to ${period.end})`);
    return runSummariesForPeriod_(period, {});
  } catch (e) {
    sendErrorAlert('Fortnightly attendance summary failed: ' + (e && e.message ? e.message : e), { functionName: 'sendScheduledSummaries' });
    throw e;
  }
}

/** Manual re-send of whatever the scheduled run would post, to the real channels. */
function sendScheduledSummariesNow() {
  const period = resolveSummaryPeriod_(new Date());
  return runSummariesForPeriod_(period, {});
}

/** Logs the messages without posting and without writing state. */
function previewScheduledSummaries() {
  const period = resolveSummaryPeriod_(new Date());
  return runSummariesForPeriod_(period, { dryRun: true });
}

/**
 * Test the 16th run at any time: builds the 1st-15th period for the current
 * month regardless of today's date, posts to the test channel, writes no state.
 * Note that run mid-month it only has the date columns that exist so far.
 */
function testFirstHalfSummaries() {
  const period = firstHalfPeriod_(new Date());
  return runSummariesForPeriod_(period, { test: true });
}

/** Test the 1st run at any time: 16th-end of last month, to the test channel. */
function testSecondHalfSummaries() {
  const period = secondHalfPeriod_(new Date());
  return runSummariesForPeriod_(period, { test: true });
}

/** Day-by-day breakdown, logged not posted. Use it when someone disputes a number. */
function logDetailedAudit(groupKey) {
  const period = resolveSummaryPeriod_(new Date());
  const snapshot = readMissionHqSnapshot_(period.start, period.end);
  const groups = groupKey
    ? SUMMARY_GROUPS.filter(group => group.key === groupKey)
    : SUMMARY_GROUPS;

  groups.forEach(group => {
    const members = resolveGroupMembers_(group, snapshot);
    const results = computeMemberMetrics_(members, snapshot, group.key, period);
    Logger.log(`\n═══ ${group.title} — ${period.label} (${snapshot.dateColumns.length} working days) ═══`);
    results.forEach(member => {
      Logger.log(`\n${member.name}`);
      Logger.log(`  WFO=${member.wfo} WFH=${member.wfh} WFA=${member.wfa} (YTD ${member.wfaYtd}/${WFA_ANNUAL_CAP}, ${member.wfaOverCap} over-cap this period) Leave=${member.leave} Pending=${member.pending}`);
      Logger.log(`  Available=${member.available} (${snapshot.dateColumns.length} - ${member.leave} leave - ${member.wfa} WFA)`);
      Logger.log(`  True Adherence: ${member.wfo}/${member.available} = ${member.trueAdh}%`);
      Logger.log(`  CI Rate: ${member.checkedIn}/${member.available} = ${member.ciRate}%`);
      member.days.forEach(day => Logger.log(`    ${day.date}: ${day.raw || "(blank)"} → ${day.category}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function runSummariesForPeriod_(period, options) {
  const dryRun = options && options.dryRun === true;
  const testMode = options && options.test === true;
  const results = [];

  let testChannelId = "";
  if (testMode) {
    try {
      testChannelId = getTestSummaryChannelId_();
    } catch (error) {
      Logger.log(`Test run aborted: ${error.message}`);
      return { success: false, message: error.message };
    }
    Logger.log(`TEST MODE: all groups post to ${testChannelId}; no state will be written.`);
  }

  let snapshot;
  try {
    snapshot = readMissionHqSnapshot_(period.start, period.end);
  } catch (error) {
    Logger.log(`Summary run aborted: ${error.message}`);
    logToDumpSheet(`Summary run aborted: ${error.message}`);
    return { success: false, message: error.message };
  }

  if (snapshot.dateColumns.length === 0) {
    const message = `No date columns found between ${period.start} and ${period.end} — nothing to summarize.`;
    Logger.log(message);
    return { success: false, message: message };
  }

  SUMMARY_GROUPS.forEach(group => {
    try {
      const members = resolveGroupMembers_(group, snapshot);
      if (members.length === 0) {
        const reason = "no matching rows in MissionHQ Log";
        Logger.log(`Skipping ${group.title}: ${reason}`);
        results.push({ group: group.key, sent: false, message: reason });
        return;
      }

      const memberMetrics = computeMemberMetrics_(members, snapshot, group.key, period);
      const ranked = memberMetrics.filter(member => member.available > 0);
      const fullPeriodLeave = memberMetrics.filter(member => member.available === 0);

      if (ranked.length === 0) {
        const reason = "every member had no scored days (all leave/WFA) for the period";
        Logger.log(`Skipping ${group.title}: ${reason}`);
        results.push({ group: group.key, sent: false, message: reason });
        return;
      }

      // Real sends advance the snapshot counter; previews and tests must not.
      const snapshotNumber = readSnapshotNumber_(group.key) + 1;
      const tiers = assignSummaryTiers_(ranked);
      const targetChannel = testMode ? testChannelId : group.channelId;
      const message = buildSnapshotMessage_(
        group, ranked, tiers, fullPeriodLeave, snapshot, period, snapshotNumber
      );

      if (testMode) {
        message.blocks.unshift({
          type: "context",
          elements: [{
            type: "mrkdwn",
            text: `:test_tube: *TEST* — would post to <#${group.channelId}> as "${group.botName}"`
          }]
        });
      }

      if (dryRun) {
        Logger.log(
          `--- ${group.title} -> ${targetChannel} (${group.botName}) ---\n` +
          `${message.text}\n${renderBlocksForLog_(message.blocks)}`
        );
        results.push({ group: group.key, sent: false, message: "dry run", people: ranked.length });
        return;
      }

      const posted = postSummaryToSlack_(targetChannel, group.botName, message);
      if (posted.success && !testMode) {
        saveScores_(group.key, ranked, period);
        saveSnapshotNumber_(group.key, snapshotNumber);
      }

      results.push({
        group: group.key,
        sent: posted.success,
        message: posted.message,
        people: ranked.length
      });
      Utilities.sleep(1000); // stay polite with Slack rate limits
    } catch (groupError) {
      Logger.log(`Failed summary for ${group.title}: ${groupError.message}`);
      logToDumpSheet(`Failed summary for ${group.title}: ${groupError.message}`);
      results.push({ group: group.key, sent: false, message: groupError.message });
    }
  });

  Logger.log(`Summary run complete (${period.label}): ${JSON.stringify(results)}`);
  return { success: true, period: period, dryRun: dryRun, test: testMode, results: results };
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/**
 * The two halves never overlap and are always fully finished before they are
 * reported, so the run hour does not matter and deltas compare like with like:
 *
 *   run on the 16th -> 1st-15th of this month
 *   run on the 1st  -> 16th-end of last month
 */
function resolveSummaryPeriod_(today) {
  const tz = Session.getScriptTimeZone();
  const dayOfMonth = parseInt(Utilities.formatDate(today, tz, "d"), 10);
  return dayOfMonth >= 16
    ? firstHalfPeriod_(today)
    : secondHalfPeriod_(today);
}

/** 1st -> 15th of the month `today` falls in. */
function firstHalfPeriod_(today) {
  const tz = Session.getScriptTimeZone();
  const year = parseInt(Utilities.formatDate(today, tz, "yyyy"), 10);
  const month = parseInt(Utilities.formatDate(today, tz, "MM"), 10);
  return buildPeriod_(new Date(year, month - 1, 1), new Date(year, month - 1, 15));
}

/** 16th -> last day of the month before the one `today` falls in. */
function secondHalfPeriod_(today) {
  const tz = Session.getScriptTimeZone();
  const year = parseInt(Utilities.formatDate(today, tz, "yyyy"), 10);
  const month = parseInt(Utilities.formatDate(today, tz, "MM"), 10);
  // Day 0 of this month is the last day of the previous one — 28th to 31st.
  return buildPeriod_(new Date(year, month - 2, 16), new Date(year, month - 1, 0));
}

function buildPeriod_(start, end) {
  const tz = Session.getScriptTimeZone();
  return {
    start: formatSummaryDate_(start),
    end: formatSummaryDate_(end),
    label: `${Utilities.formatDate(start, tz, "d")}–${Utilities.formatDate(end, tz, "d MMMM yyyy")}`
  };
}

function formatSummaryDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// MissionHQ Log reading
// ---------------------------------------------------------------------------

/**
 * Reads the log once and returns the rows plus the date columns that fall
 * inside [startDate, endDate]. Date headers are yyyy-MM-dd so string compare is
 * enough. Uses display values so date headers and statuses read as text.
 */
function readMissionHqSnapshot_(startDate, endDate) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} has no data rows`);

  const headers = data[0].map(header => header.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  const nameColIndex = headers.indexOf("Full Name");
  if (emailColIndex === -1) throw new Error(`Column "Email Address" not found in ${CANDIDATE_SHEET_NAME}`);

  const dateColumns = [];
  headers.forEach((header, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(header)) return;
    if (header >= startDate && header <= endDate) {
      dateColumns.push({ date: header, index: index });
    }
  });
  dateColumns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Every date column in the period's calendar year up to and including its end,
  // used only to count year-to-date WFA against the annual cap.
  const yearPrefix = endDate.slice(0, 4); // "2026"
  const ytdDateColumns = [];
  headers.forEach((header, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(header)) return;
    if (header.slice(0, 4) === yearPrefix && header <= endDate) {
      ytdDateColumns.push({ date: header, index: index });
    }
  });

  return {
    headers: headers,
    rows: data.slice(1),
    emailColIndex: emailColIndex,
    nameColIndex: nameColIndex,
    departmentColIndex: headers.indexOf("Department"),
    locationColIndex: headers.indexOf("Location"),
    dateColumns: dateColumns,
    ytdDateColumns: ytdDateColumns
  };
}

function resolveGroupMembers_(group, snapshot) {
  const matcher = group.match;

  if (matcher.type === "column") {
    const colIndex = snapshot.headers.indexOf(matcher.column);
    if (colIndex === -1) {
      throw new Error(`Column "${matcher.column}" not found in ${CANDIDATE_SHEET_NAME}`);
    }
    const wanted = matcher.values.map(normalizeSummaryKey_);
    return snapshot.rows.filter(row => {
      const cell = row[colIndex] ? row[colIndex].toString() : "";
      return splitCellTokens_(cell).some(token => wanted.indexOf(token) !== -1);
    });
  }

  if (matcher.type === "columnPattern") {
    const colIndex = snapshot.headers.indexOf(matcher.column);
    if (colIndex === -1) {
      throw new Error(`Column "${matcher.column}" not found in ${CANDIDATE_SHEET_NAME} — run "Sync PMS Levels" once`);
    }
    return snapshot.rows.filter(row => {
      const cell = row[colIndex] ? row[colIndex].toString() : "";
      return matcher.pattern.test(normalizeSummaryKey_(cell));
    });
  }

  if (matcher.type === "roster") {
    const rosterEmails = readRosterEmails_(matcher.sheet);
    if (rosterEmails.length === 0) {
      throw new Error(`Roster sheet "${matcher.sheet}" has no email addresses`);
    }

    const wanted = {};
    rosterEmails.forEach(email => { wanted[email] = false; });

    const members = snapshot.rows.filter(row => {
      const email = row[snapshot.emailColIndex]
        ? row[snapshot.emailColIndex].toString().trim().toLowerCase()
        : "";
      if (!email || !(email in wanted)) return false;
      wanted[email] = true;
      return true;
    });

    // Someone on the roster with no Log row would silently vanish from the
    // summary, so name them instead of quietly reporting a short group.
    const missing = Object.keys(wanted).filter(email => !wanted[email]);
    if (missing.length > 0) {
      Logger.log(
        `Roster "${matcher.sheet}": ${missing.length} email(s) not found in ` +
        `${CANDIDATE_SHEET_NAME} — ${missing.join(", ")}`
      );
    }
    Logger.log(`Roster "${matcher.sheet}": ${members.length} of ${rosterEmails.length} matched.`);

    return members;
  }

  throw new Error(`Unknown matcher type "${matcher.type}" for group ${group.key}`);
}

/**
 * Lower-cased, de-duplicated emails from a roster tab's email column. The
 * header is looked up by name (never by position) among
 * SUMMARY_ROSTER_EMAIL_COLUMNS, so the tab can carry any other columns it likes.
 */
function readRosterEmails_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Roster sheet "${sheetName}" not found`);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return [];

  const headers = data[0].map(header => header.toString().trim());
  const emailColIndex = findColumnIndexByCandidates_(headers, SUMMARY_ROSTER_EMAIL_COLUMNS);
  if (emailColIndex === -1) {
    throw new Error(
      `No email column (${SUMMARY_ROSTER_EMAIL_COLUMNS.join(" / ")}) in roster sheet "${sheetName}"`
    );
  }

  const seen = {};
  const emails = [];
  data.slice(1).forEach(row => {
    const email = row[emailColIndex] ? row[emailColIndex].toString().trim().toLowerCase() : "";
    if (!email || email in seen) return;
    seen[email] = true;
    emails.push(email);
  });
  return emails;
}

/** "Finance, FLG" -> ["finance", "flg"] */
function splitCellTokens_(cell) {
  return cell
    .split(",")
    .map(part => normalizeSummaryKey_(part))
    .filter(part => part !== "");
}

/** Lower-cases and drops spaces/punctuation so "People & Culture" == "people&culture". */
function normalizeSummaryKey_(value) {
  return (value === null || value === undefined ? "" : value.toString())
    .toLowerCase()
    .replace(/[^a-z0-9&+]/g, "");
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * One row per member, ranked by True WFO Adherence (CI rate breaks ties).
 *
 *   available   = working days − leave − WFA-within-entitlement
 *   True WFO    = WFO days ÷ available days              (the ranking metric)
 *   CI rate     = checked-in days ÷ available days
 *
 * WFA (Work From Anywhere) is excluded from the denominator ONLY up to the
 * 10-day annual entitlement. A person's first 10 WFA days of the year are
 * neutral, like leave. Every WFA day beyond the 10th is over-entitlement: it
 * stays in the denominator and is NOT counted as office, so it drags adherence
 * down — which is the point, since that person is over their cap. Whether a
 * period's WFA days are within the allowance is decided by how many WFA days the
 * person already used earlier in the year (priorWfa).
 *
 * A blank cell counts as Pending, matching "pending = invisible": a day with no
 * check-in cannot be credited as presence.
 */
function computeMemberMetrics_(members, snapshot, groupKey, period) {
  const previousScores = readPreviousScores_(groupKey, period);

  const results = members.map(row => {
    const name = snapshot.nameColIndex !== -1 && row[snapshot.nameColIndex]
      ? row[snapshot.nameColIndex].toString().trim()
      : (row[snapshot.emailColIndex] || "").toString().trim();

    let wfo = 0;
    let wfh = 0;
    let wfa = 0;
    let leave = 0;
    let pending = 0;
    const days = [];

    snapshot.dateColumns.forEach(column => {
      const raw = row[column.index] ? row[column.index].toString().trim() : "";
      const category = classifyAttendanceStatus_(raw);
      days.push({ date: column.date, raw: raw, category: category });
      if (category === "WFO") wfo++;
      else if (category === "WFH") wfh++;
      else if (category === "WFA") wfa++;
      else if (category === "LEAVE") leave++;
      else pending++;
    });

    // Year-to-date WFA for this row, across every date column in the year up to
    // the period end — this is the running total the 10-day cap applies to.
    let wfaYtd = 0;
    (snapshot.ytdDateColumns || []).forEach(column => {
      const raw = row[column.index] ? row[column.index].toString().trim() : "";
      if (classifyAttendanceStatus_(raw) === "WFA") wfaYtd++;
    });

    const totalDays = snapshot.dateColumns.length;

    // Split this period's WFA into "within entitlement" and "over cap". The
    // person's WFA days earlier in the year (priorWfa) consume the allowance
    // first, so a heavy user has none left by the time this period runs.
    const priorWfa = Math.max(0, wfaYtd - wfa);
    const allowanceLeft = Math.max(0, WFA_ANNUAL_CAP - priorWfa);
    const wfaWithin = Math.min(wfa, allowanceLeft); // neutral, excluded like leave
    const wfaOverCap = wfa - wfaWithin;             // counts in the denominator, not office

    // Only within-entitlement WFA is excused from the denominator. Over-cap WFA
    // stays in, and is a check-in (they did respond) but not office.
    const available = totalDays - leave - wfaWithin;
    const checkedIn = wfo + wfh + wfaOverCap;
    const trueAdh = available > 0 ? Math.round((wfo / available) * 100) : 0;
    const ciRate = available > 0 ? Math.round((checkedIn / available) * 100) : 0;
    const wfoQuality = checkedIn > 0 ? Math.round((wfo / checkedIn) * 100) : null;

    const previous = previousScores[name];
    const delta = previous === undefined ? null : trueAdh - previous;

    return {
      name: name,
      wfo: wfo,
      wfh: wfh,
      wfa: wfa,
      wfaYtd: wfaYtd,
      wfaOverCap: wfaOverCap,
      leave: leave,
      pending: pending,
      available: available,
      checkedIn: checkedIn,
      trueAdh: trueAdh,
      ciRate: ciRate,
      wfoQuality: wfoQuality,
      delta: delta,
      days: days
    };
  });

  results.sort((a, b) => (b.trueAdh !== a.trueAdh ? b.trueAdh - a.trueAdh : b.ciRate - a.ciRate));
  return results;
}

function classifyAttendanceStatus_(raw) {
  if (!raw) return "PENDING";
  const normalized = normalizeSummaryKey_(raw);
  if (normalized === "pending") return "PENDING";
  if (WFO_STATUSES.some(status => normalizeSummaryKey_(status) === normalized)) return "WFO";
  if (WFA_STATUSES.some(status => normalizeSummaryKey_(status) === normalized)) return "WFA";
  if (LEAVE_STATUSES.some(status => normalizeSummaryKey_(status) === normalized)) return "LEAVE";
  if (WFH_STATUSES.some(status => normalizeSummaryKey_(status) === normalized)) return "WFH";
  // Unrecognised wording that still clearly means office presence, e.g.
  // "Office (AM)". WFA is deliberately excluded from this fallback.
  if (normalized.indexOf("office") !== -1 || normalized.indexOf("client") !== -1) return "WFO";
  return "PENDING";
}

function assignSummaryTiers_(results) {
  const tiers = SUMMARY_TIERS.map(tier => ({
    key: tier.key,
    emoji: tier.emoji,
    label: tier.label,
    members: []
  }));

  results.forEach(member => {
    for (let i = 0; i < SUMMARY_TIERS.length; i++) {
      if (member.trueAdh >= SUMMARY_TIERS[i].min) {
        tiers[i].members.push(member);
        return;
      }
    }
    tiers[tiers.length - 1].members.push(member);
  });

  return tiers;
}

// ---------------------------------------------------------------------------
// Per-group state (deltas + snapshot number)
// ---------------------------------------------------------------------------

function periodKey_(period) {
  return `${period.start}..${period.end}`;
}

/**
 * Scores from the previous real send, keyed by member name.
 *
 * Returns {} when the stored scores are from the SAME period being reported —
 * re-sending a period would otherwise diff it against itself and print a
 * meaningless "no change" on every row.
 */
function readPreviousScores_(groupKey, period) {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(SUMMARY_SCORES_PROPERTY_PREFIX + groupKey);
  if (!raw) return {};

  let stored;
  try {
    stored = JSON.parse(raw);
  } catch (error) {
    Logger.log(`Ignoring unreadable previous scores for ${groupKey}: ${error.message}`);
    return {};
  }

  // Older sends stored a bare { name: score } map with no period attached.
  if (!stored.scores) return stored;

  if (period && stored.period === periodKey_(period)) {
    Logger.log(`No deltas for ${groupKey}: stored scores are from this same period (${stored.period})`);
    return {};
  }
  return stored.scores;
}

function saveScores_(groupKey, results, period) {
  const scores = {};
  results.forEach(member => { scores[member.name] = member.trueAdh; });
  try {
    PropertiesService.getScriptProperties().setProperty(
      SUMMARY_SCORES_PROPERTY_PREFIX + groupKey,
      JSON.stringify({ period: periodKey_(period), scores: scores })
    );
  } catch (error) {
    // A script property caps at ~9KB; a very large group would trip it. Deltas
    // are a nice-to-have, so never let this fail a send that already went out.
    Logger.log(`Could not save scores for ${groupKey}: ${error.message}`);
  }
}

/** Logs the stored delta baseline and snapshot number for every group. */
function logSummaryState() {
  const props = PropertiesService.getScriptProperties();
  SUMMARY_GROUPS.forEach(group => {
    const raw = props.getProperty(SUMMARY_SCORES_PROPERTY_PREFIX + group.key);
    const snapshotNumber = readSnapshotNumber_(group.key);
    if (!raw) {
      Logger.log(`${group.title}: snapshot ${snapshotNumber}, no stored scores (first send shows no deltas)`);
      return;
    }
    const stored = JSON.parse(raw);
    const scores = stored.scores || stored;
    Logger.log(
      `${group.title}: snapshot ${snapshotNumber}, baseline period ${stored.period || "(legacy, unknown)"}, ` +
      `${Object.keys(scores).length} member score(s)`
    );
  });
}

function readSnapshotNumber_(groupKey) {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(SUMMARY_SNAPSHOT_PROPERTY_PREFIX + groupKey);
  const parsed = parseInt(raw || "0", 10);
  return isNaN(parsed) ? 0 : parsed;
}

function saveSnapshotNumber_(groupKey, value) {
  PropertiesService.getScriptProperties()
    .setProperty(SUMMARY_SNAPSHOT_PROPERTY_PREFIX + groupKey, String(value));
}

function ordinal_(n) {
  if (n >= 1 && n <= SUMMARY_ORDINALS.length) return SUMMARY_ORDINALS[n - 1];
  const suffixes = ["th", "st", "nd", "rd"];
  const mod100 = n % 100;
  return n + (suffixes[(mod100 - 20) % 10] || suffixes[mod100] || suffixes[0]);
}

// ---------------------------------------------------------------------------
// Message formatting (Slack Block Kit)
//
// Built as blocks rather than one text blob so the message has a visual
// hierarchy: the headline numbers as a scannable KPI row, the ranking as an
// aligned monospace table with adherence bars, and the methodology as small
// print at the bottom where it belongs.
//
// The tables live in code blocks because that is the only way Slack gives us
// column alignment — emoji do not render there, hence the text markers.
// ---------------------------------------------------------------------------

const SUMMARY_BAR_WIDTH = 10;
const SUMMARY_NAME_WIDTH = 22;
// A section's text caps at 3000 chars; keep tables well under it and split.
const SUMMARY_BLOCK_CHAR_BUDGET = 2600;

/**
 * Returns { text, blocks } — `text` is the notification fallback shown in the
 * sidebar and on mobile push, `blocks` is the rendered message.
 */
function buildSnapshotMessage_(group, ranked, tiers, fullPeriodLeave, snapshot, period, snapshotNumber) {
  const workingDays = snapshot.dateColumns.length;
  const totalMembers = ranked.length;

  const totalWfo = sumBy_(ranked, member => member.wfo);
  const totalAvailable = sumBy_(ranked, member => member.available);
  const totalCheckedIn = sumBy_(ranked, member => member.checkedIn);
  const totalPending = sumBy_(ranked, member => member.pending);
  const totalWfa = sumBy_(ranked, member => member.wfa);
  const totalSlots = totalMembers * workingDays;

  const orgTrueAdh = totalAvailable > 0 ? Math.round((totalWfo / totalAvailable) * 100) : 0;
  const orgCi = totalAvailable > 0 ? Math.round((totalCheckedIn / totalAvailable) * 100) : 0;
  const orgPendingPct = totalSlots > 0 ? Math.round((totalPending / totalSlots) * 100) : 0;

  const tierS = tiers.filter(tier => tier.key === "S")[0];
  const tierA = tiers.filter(tier => tier.key === "A")[0];
  const tierD = tiers.filter(tier => tier.key === "D")[0];
  const at80Plus = tierS.members.length + tierA.members.length;

  const orgDelta = orgDelta_(ranked);
  const blocks = [];

  // No header block: the bot's display name already reads "<Group> Attendance
  // Summary", so a "<Group> · Attendance Snapshot" line only repeated it.
  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text:
        `*${period.label}*  ·  ${workingDays} working days  ·  ${totalMembers} people  ·  ` +
        `${ordinal_(snapshotNumber)} snapshot`
    }]
  });

  // --- Headline numbers ---------------------------------------------------
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*True WFO Adherence*\n\`${bar_(orgTrueAdh)}\`  *${orgTrueAdh}%*${orgDelta}`
    }
  });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Check-in rate*\n${orgCi}%` },
      { type: "mrkdwn", text: `*Pending days*\n${orgPendingPct}%` },
      { type: "mrkdwn", text: `*Meeting the 4-day standard*\n${at80Plus} of ${totalMembers} (80%+)` },
      { type: "mrkdwn", text: `*Days counted*\n${totalWfo} WFO of ${totalAvailable} available` },
      { type: "mrkdwn", text: `*WFA days*\n${totalWfa} (tracked separately)` }
    ]
  });

  // --- Stack ranking ------------------------------------------------------
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Stack ranking*\n_Ranked by True WFO Adherence — WFO days ÷ available days._"
    }
  });

  let rank = 0;
  tiers.forEach(tier => {
    if (tier.members.length === 0) return;
    const plural = tier.members.length === 1 ? "member" : "members";
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${tier.emoji}  *${tier.label}*  ·  ${tier.members.length} ${plural}` }
    });

    const rows = tier.members.map(member => {
      rank++;
      return tableRow_(rank, member, tier.key);
    });
    chunkRows_(rows).forEach(chunk => {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "```\n" + chunk.join("\n") + "\n```" }
      });
    });
  });

  if (fullPeriodLeave.length > 0) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `_Not ranked — leave/WFA for the full period: ${fullPeriodLeave.map(m => m.name).join(", ")}._`
      }]
    });
  }

  // --- WFA annual cap ------------------------------------------------------
  // Scanned across everyone in the group, not just the ranked members, so a
  // person who was all-WFA this period is still flagged.
  const capWarning = wfaCapWarningBlock_(ranked.concat(fullPeriodLeave));
  if (capWarning) blocks.push(capWarning);

  // --- The ask ------------------------------------------------------------
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        "*Our ask*\n" +
        ":one:  *Check in every morning* — Office, Client, WFH, Travel, Leave, WFA all count. " +
        "5 seconds, every day.\n" +
        ":two:  *Wednesday is the default WFH day* — WFH on other days should be a genuine exception.\n" +
        ":three:  *Pending = invisible* — a pending day cannot be credited as office presence, " +
        "even if you were there."
    }
  });

  if (tierD.members.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:wave:  *${tierD.members.map(m => m.name).join(", ")}* — please DM PnC so we can fix the ` +
          "check-in gap before the next snapshot."
      }
    });
  }

  // --- Methodology, as small print ----------------------------------------
  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text:
        `*How this is calculated*  ·  *Available days* = ${workingDays} working days − leave − WFA; ` +
        "leave and WFA (up to the 10-day yearly entitlement) are excluded, counting " +
        "neither for nor against you. WFA days beyond 10/year DO count against adherence  ·  " +
        "*True WFO Adherence* = WFO days ÷ available days  ·  " +
        "*WFO* = Office, Client, Client Location, Split Day, Travel, Office + Client, " +
        "Compensatory WFH, Half Day Office Leave  ·  *WFH* = Home, Half Day WFH Leave."
    }]
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Thank you :pray:  —  ${SUMMARY_SIGN_OFF}` }]
  });

  const text =
    `${group.title} attendance — ${period.label}: ${orgTrueAdh}% WFO adherence, ` +
    `${at80Plus} of ${totalMembers} meeting the standard`;

  return { text: text, blocks: blocks };
}

/** " 1  Navien Ramesh        ██████████  100%  22/22  ▲ +12" */
function tableRow_(rank, member, tierKey) {
  const rankCell = String(rank).padStart(2);
  const name = truncate_(member.name, SUMMARY_NAME_WIDTH).padEnd(SUMMARY_NAME_WIDTH);

  if (tierKey === "D") {
    return `${rankCell}  ${name}  ${"·".repeat(SUMMARY_BAR_WIDTH)}    —   0/${member.available}`;
  }

  const pct = `${member.trueAdh}%`.padStart(4);
  const days = `${member.wfo}/${member.available}`.padStart(5);
  return `${rankCell}  ${name}  ${bar_(member.trueAdh)}  ${pct}  ${days}${deltaCell_(member.delta)}`;
}

function deltaCell_(delta) {
  if (delta === null || Math.abs(delta) < SUMMARY_DELTA_BOLD_PP) return "";
  return `  ${delta > 0 ? "▲ +" : "▼ "}${delta}`;
}

/** Ten-cell adherence bar, e.g. 76% -> "████████░░". */
function bar_(percent) {
  const filled = Math.max(0, Math.min(SUMMARY_BAR_WIDTH, Math.round((percent / 100) * SUMMARY_BAR_WIDTH)));
  return "█".repeat(filled) + "░".repeat(SUMMARY_BAR_WIDTH - filled);
}

function truncate_(value, width) {
  const text = (value || "").toString();
  return text.length <= width ? text : text.slice(0, width - 1) + "…";
}

/** Splits table rows so no single section block exceeds Slack's 3000 chars. */
function chunkRows_(rows) {
  const chunks = [];
  let current = [];
  let size = 0;
  rows.forEach(row => {
    if (size + row.length + 1 > SUMMARY_BLOCK_CHAR_BUDGET && current.length > 0) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += row.length + 1;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Group-level movement, shown next to the headline adherence number. */
function orgDelta_(ranked) {
  const withDelta = ranked.filter(member => member.delta !== null);
  if (withDelta.length === 0) return "";
  const previousAdh = Math.round(
    sumBy_(withDelta, member => member.trueAdh - member.delta) / withDelta.length
  );
  const currentAdh = Math.round(sumBy_(withDelta, member => member.trueAdh) / withDelta.length);
  const delta = currentAdh - previousAdh;
  if (delta === 0) return "  _(no change)_";
  return `  _(${delta > 0 ? "▲ +" : "▼ "}${delta}pp vs last snapshot)_`;
}

function sumBy_(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

/**
 * A context block naming anyone at or over the annual WFA cap, plus anyone one
 * or two days away, so managers can act before the limit is breached. Returns
 * null when nobody is close. `member.wfaYtd` is the running year-to-date count.
 */
function wfaCapWarningBlock_(members) {
  const atOrOver = members
    .filter(member => (member.wfaYtd || 0) >= WFA_ANNUAL_CAP)
    .sort((a, b) => b.wfaYtd - a.wfaYtd);
  const approaching = members
    .filter(member => {
      const used = member.wfaYtd || 0;
      return used >= WFA_ANNUAL_CAP - 2 && used < WFA_ANNUAL_CAP;
    })
    .sort((a, b) => b.wfaYtd - a.wfaYtd);

  if (atOrOver.length === 0 && approaching.length === 0) return null;

  const parts = [];
  if (atOrOver.length > 0) {
    parts.push(
      `:warning:  *WFA annual cap (${WFA_ANNUAL_CAP}/yr) reached:* ` +
      atOrOver.map(m => `${m.name} (${m.wfaYtd})`).join(", ")
    );
  }
  if (approaching.length > 0) {
    parts.push(
      `_Approaching the cap: ${approaching.map(m => `${m.name} (${m.wfaYtd})`).join(", ")}._`
    );
  }
  return { type: "context", elements: [{ type: "mrkdwn", text: parts.join("\n") }] };
}

/** Flattens blocks into readable text for dry-run logging. */
function renderBlocksForLog_(blocks) {
  return blocks.map(block => {
    if (block.type === "divider") return "────────────────────────────────────────";
    if (block.type === "header") return `\n### ${block.text.text}`;
    if (block.type === "context") return block.elements.map(el => el.text).join(" ");
    if (block.type === "section" && block.fields) return block.fields.map(f => f.text).join("\n");
    if (block.type === "section") return block.text.text;
    return JSON.stringify(block);
  }).join("\n");
}

// ---------------------------------------------------------------------------
// PMS level sync
// ---------------------------------------------------------------------------

/**
 * Fills the MissionHQ Log's "PMS Level" column from the PMS master sheet,
 * matched on email. Also called at the end of syncEmployeesFromZohoOrgTree().
 *
 * Rows whose email is absent from the PMS sheet are left untouched (they are
 * reported in the log). A row present in PMS with a blank level is cleared, so a
 * demotion out of M-level does not leave a stale value behind.
 */
function syncPmsLevelsToLog() {
  const levelsByEmail = getPmsLevelsByEmail_();

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} has no data rows`);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  if (emailColIndex === -1) throw new Error(`Column "Email Address" not found in ${CANDIDATE_SHEET_NAME}`);

  const levelCol = getOrCreateColumnIndex_(sheet, PMS_LEVEL_COLUMN);
  const rowCount = lastRow - 1;

  const emails = sheet.getRange(2, emailColIndex + 1, rowCount, 1).getDisplayValues();
  const existing = sheet.getRange(2, levelCol.index + 1, rowCount, 1).getDisplayValues();

  const output = [];
  let updated = 0;
  let managers = 0;
  let unmatched = 0;

  for (let i = 0; i < rowCount; i++) {
    const email = emails[i][0] ? emails[i][0].toString().trim().toLowerCase() : "";
    const current = existing[i][0] ? existing[i][0].toString().trim() : "";

    if (!email || !levelsByEmail.hasOwnProperty(email)) {
      if (email) unmatched++;
      output.push([current]); // leave anything already there alone
      continue;
    }

    const level = levelsByEmail[email];
    if (level !== current) updated++;
    if (PMS_MANAGER_LEVEL_PATTERN.test(normalizeSummaryKey_(level))) managers++;
    output.push([level]);
  }

  sheet.getRange(2, levelCol.index + 1, rowCount, 1).setValues(output);
  SpreadsheetApp.flush();

  const message =
    `PMS level sync: ${updated} cell(s) updated, ${managers} manager-level (M*) row(s), ` +
    `${unmatched} log row(s) not found in the PMS sheet`;
  Logger.log(message);
  return { success: true, updated: updated, managers: managers, unmatched: unmatched, message: message };
}

/**
 * Returns { email: level } for every PMS row that has an email — all levels
 * (M1, IC 2, AM, ...), not just managers. Reads only the email and level
 * columns, so the rest of the row (compensation) is never fetched.
 */
function getPmsLevelsByEmail_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty(PMS_MASTER_SHEET_ID_PROPERTY);
  if (!sheetId) {
    throw new Error(`${PMS_MASTER_SHEET_ID_PROPERTY} script property is not set`);
  }

  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(PMS_MASTER_TAB_NAME);
  if (!sheet) throw new Error(`Tab "${PMS_MASTER_TAB_NAME}" not found in the PMS master sheet`);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= PMS_HEADER_ROW) throw new Error("PMS master sheet has no data rows");

  const headers = sheet.getRange(PMS_HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0]
    .map(header => normalizeSummaryKey_(header));

  const emailColIndex = findHeaderIndex_(headers, PMS_EMAIL_COLUMNS);
  const levelColIndex = findHeaderIndex_(headers, PMS_LEVEL_COLUMNS);
  if (emailColIndex === -1) {
    throw new Error(`No email column found in the PMS master sheet (looked for ${PMS_EMAIL_COLUMNS.join(", ")})`);
  }
  if (levelColIndex === -1) {
    throw new Error(`No level column found in the PMS master sheet (looked for ${PMS_LEVEL_COLUMNS.join(", ")})`);
  }

  const rowCount = lastRow - PMS_HEADER_ROW;
  const emails = sheet.getRange(PMS_HEADER_ROW + 1, emailColIndex + 1, rowCount, 1).getDisplayValues();
  const levels = sheet.getRange(PMS_HEADER_ROW + 1, levelColIndex + 1, rowCount, 1).getDisplayValues();

  const levelsByEmail = {};
  let managerCount = 0;
  for (let i = 0; i < rowCount; i++) {
    const email = emails[i][0] ? emails[i][0].toString().trim().toLowerCase() : "";
    if (!email) continue;
    const level = levels[i][0] ? levels[i][0].toString().trim() : "";
    levelsByEmail[email] = level;
    if (PMS_MANAGER_LEVEL_PATTERN.test(normalizeSummaryKey_(level))) managerCount++;
  }

  Logger.log(
    `PMS master sheet: ${Object.keys(levelsByEmail).length} employee(s), ${managerCount} at manager level (M*)`
  );
  return levelsByEmail;
}

function findHeaderIndex_(normalizedHeaders, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const index = normalizedHeaders.indexOf(normalizeSummaryKey_(candidates[i]));
    if (index !== -1) return index;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Slack posting
// ---------------------------------------------------------------------------

function getSummaryBotToken_() {
  return getRequiredScriptProperty_(SUMMARY_BOT_TOKEN_PROPERTY);
}

function getTestSummaryChannelId_() {
  return getRequiredScriptProperty_(TEST_SUMMARY_CHANNEL_PROPERTY);
}

/**
 * Posts as the HV Automation bot with a per-channel display name. No icon_url /
 * icon_emoji is sent, so the bot keeps its own profile image everywhere.
 */
function postSummaryToSlack_(channelId, botName, message) {
  const url = "https://slack.com/api/chat.postMessage";
  const payload = JSON.stringify({
    channel: channelId,
    text: message.text, // notification fallback (sidebar + mobile push)
    blocks: message.blocks,
    username: botName,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false
  });

  const options = {
    method: "post",
    contentType: "application/json; charset=utf-8",
    headers: {
      Authorization: `Bearer ${getSummaryBotToken_()}`
    },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    if (json.ok) {
      Logger.log(`Summary posted to ${channelId} as "${botName}" (ts ${json.ts})`);
      return { success: true, ts: json.ts, message: `Posted to ${channelId}` };
    }
    Logger.log(`Slack error posting summary to ${channelId}: ${json.error}`);
    logToDumpSheet(`Slack error posting summary to ${channelId}: ${json.error}`);
    return { success: false, message: `Slack API error: ${json.error}` };
  } catch (error) {
    Logger.log(`Error posting summary to ${channelId}: ${error.message}`);
    logToDumpSheet(`Error posting summary to ${channelId}: ${error.message}`);
    return { success: false, message: `Error posting summary: ${error.message}` };
  }
}
