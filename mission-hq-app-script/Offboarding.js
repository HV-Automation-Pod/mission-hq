// ---------------------------------------------------------------------------
// Offboarding sweep — takes people who have left the company out of the daily
// prompt, the reminder and every fortnightly summary.
//
// The employee sync (SyncEmployees.js) is additive: it adds joiners and updates
// live rows, but nothing ever told the sheet that somebody had gone. A leaver's
// row therefore stayed in the MissionHQ Log for ever, and because Slack keeps a
// deactivated user's DM channel alive, chat.postMessage KEPT SUCCEEDING — so the
// daily flow stamped "Pending" on them every working day, and the fortnightly
// summary ranked them at 0% and named them in the "please DM PnC about your
// check-in gap" call-out. That is how Nidhi Sandur, offboarded from Zoho months
// earlier and deactivated in Slack, was still appearing in the G&A snapshot
// (Gayathiri, 2026-09-16).
//
// The fix writes into the WFO Exempt column, which the prompt flow, the
// reminder flow and resolveGroupMembers_() all already honour. One mechanism,
// three consumers, nothing new to remember. Nothing is ever deleted — their
// history stays in the sheet, it just stops being reported from now on, and
// clearing the cell by hand puts anyone straight back.
// ---------------------------------------------------------------------------

// Two independent signals, and they are deliberately NOT symmetric:
//
//   Zoho org tree   the authority on employment. The endpoint returns every
//                   active employee, so absent from it == no longer employed.
//   Slack           only DEACTIVATION counts. "Has no Slack account" does not:
//                   a brand-new hire is in Zoho days before they get a Slack
//                   account, and marking them exempt would silence their
//                   prompts for ever. Deactivated is a positive statement that
//                   the account is finished; missing is just absence of news.
const EXIT_REASON_NOT_IN_ZOHO = "not in Zoho org tree";
const EXIT_REASON_SLACK_DEACTIVATED = "Slack account deactivated";

// A truncated org-tree response would otherwise read as "the whole company
// left" and mark everyone exempt in one pass. If more than this fraction of the
// live roster looks exited, something is wrong with the data, not the company —
// abort and alert instead. markExitedEmployees({ force: true }) overrides it for
// the real mass-exit case.
const EXIT_SWEEP_MAX_EXIT_FRACTION = 0.2;
// Below this many live rows the fraction is meaningless, so only the absolute
// count guards a small sheet.
const EXIT_SWEEP_MIN_ROWS_FOR_FRACTION = 20;

// users.list is paginated and Tier 2 (~20 req/min). The org is a few hundred
// people, so this bound is a runaway guard, not a real limit.
const SLACK_DIRECTORY_PAGE_SIZE = 200;
const SLACK_DIRECTORY_MAX_PAGES = 25;

/**
 * Marks everyone who has left as WFO Exempt. Idempotent — a row that already
 * carries an exempt value is never touched, so hand-written reasons survive.
 *
 * @param {Object} [options]
 * @param {Array<Object>} [options.employees]  org-tree payload, when the caller
 *        already has it (the employee sync does). Omitted → fetched here.
 * @param {boolean} [options.dryRun]  log what would change, write nothing.
 * @param {boolean} [options.force]   skip the mass-exit safety guard.
 */
function markExitedEmployees(options) {
  options = options || {};
  const dryRun = options.dryRun === true;

  const employees = options.employees || fetchZohoOrgTreeEmployees_();
  if (!employees.length) {
    // Never treat an empty payload as "everybody left".
    throw new Error("Org-tree returned no employees — refusing to mark anyone as exited");
  }

  const activeEmails = {};
  employees.forEach(emp => {
    const email = (emp.email || "").toString().trim().toLowerCase();
    if (email) activeEmails[email] = true;
  });

  // Best-effort: a Slack outage must not stop the Zoho signal from working.
  const directory = fetchSlackDirectory_();

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, marked: 0, message: "no data rows" };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  if (emailColIndex === -1) throw new Error(`Column "Email Address" not found in ${CANDIDATE_SHEET_NAME}`);
  const nameColIndex = headers.indexOf("Full Name");
  const slackIdColIndex = headers.indexOf(SLACK_USER_ID_COLUMN);

  const exemptCol = getOrCreateColumnIndex_(sheet, WFO_EXEMPT_COLUMN);
  const rowCount = lastRow - 1;
  const grid = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getDisplayValues();
  const exemptValues = sheet.getRange(2, exemptCol.index + 1, rowCount, 1).getDisplayValues();

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const candidates = [];
  let liveRows = 0;

  for (let i = 0; i < rowCount; i++) {
    const row = grid[i];
    const email = (row[emailColIndex] || "").toString().trim().toLowerCase();
    if (!email) continue;
    // Already exempt — offboarded earlier, or an approved exception. Leave the
    // existing reason alone; re-stamping it would overwrite what a human wrote.
    if (isWfoExempt_(exemptValues[i][0])) continue;

    liveRows++;

    const reasons = [];
    if (!activeEmails[email]) reasons.push(EXIT_REASON_NOT_IN_ZOHO);

    if (directory.ok) {
      const slackId = slackIdColIndex !== -1 ? (row[slackIdColIndex] || "").toString().trim() : "";
      const entry = (slackId && directory.byId[slackId]) || directory.byEmail[email];
      // Only a positive "this account is deactivated" counts — see the note on
      // EXIT_REASON_SLACK_DEACTIVATED about why missing-from-Slack does not.
      if (entry && entry.deleted) reasons.push(EXIT_REASON_SLACK_DEACTIVATED);
    }

    if (reasons.length === 0) continue;

    candidates.push({
      rowIndex: i,
      email: email,
      name: nameColIndex !== -1 ? (row[nameColIndex] || "").toString().trim() || email : email,
      reasons: reasons,
      value: `Exited — ${reasons.join(" + ")} (${today})`
    });
  }

  // Mass-exit guard: a partial org-tree response looks exactly like everybody
  // leaving at once, and the difference matters because the write silences
  // their prompts.
  const overFraction =
    liveRows >= EXIT_SWEEP_MIN_ROWS_FOR_FRACTION &&
    candidates.length > liveRows * EXIT_SWEEP_MAX_EXIT_FRACTION;
  if (overFraction && options.force !== true) {
    const message =
      `Offboarding sweep aborted: ${candidates.length} of ${liveRows} live rows look exited ` +
      `(over ${Math.round(EXIT_SWEEP_MAX_EXIT_FRACTION * 100)}%), which usually means a partial ` +
      `org-tree response rather than a real exit. Nobody was marked. Re-run ` +
      `markExitedEmployees({ force: true }) if this is genuine.`;
    Logger.log(message);
    sendErrorAlert(message, { functionName: "markExitedEmployees" });
    return { success: false, marked: 0, candidates: candidates.length, message: message };
  }

  if (candidates.length === 0) {
    Logger.log(`Offboarding sweep: nobody to mark (${liveRows} live row(s) checked).`);
    // Same shape as the dry-run return below, so a caller never has to special-
    // case "found nothing" separately from "found some".
    return {
      success: true, dryRun: dryRun, marked: 0, wouldMark: 0, names: [],
      checked: liveRows, slackChecked: directory.ok
    };
  }

  candidates.forEach(candidate => {
    Logger.log(`${dryRun ? "[dry run] would mark" : "Marking"} exited: ${candidate.name} <${candidate.email}> — ${candidate.reasons.join(" + ")}`);
  });

  if (dryRun) {
    return {
      success: true, dryRun: true, marked: 0, wouldMark: candidates.length,
      names: candidates.map(candidate => candidate.name),
      checked: liveRows, slackChecked: directory.ok
    };
  }

  candidates.forEach(candidate => { exemptValues[candidate.rowIndex][0] = candidate.value; });
  sheet.getRange(2, exemptCol.index + 1, rowCount, 1).setValues(exemptValues);
  SpreadsheetApp.flush();

  // Alerted, not just logged: this stops people being messaged and removes them
  // from a published ranking, so a wrong one needs to be visible enough to undo.
  // Names go in the body — sendErrorAlert dedupes on function + message, so a
  // count in the title would defeat the cooldown on every run.
  sendErrorAlert(
    `Offboarding sweep marked people as WFO Exempt — they will no longer be prompted or appear in attendance summaries. Clear their ${WFO_EXEMPT_COLUMN} cell to undo.`,
    {
      functionName: "markExitedEmployees",
      sheetName: CANDIDATE_SHEET_NAME,
      additionalInfo:
        `${candidates.length} marked of ${liveRows} live row(s)` +
        (directory.ok ? "" : " (Slack directory unavailable — Zoho signal only)") +
        `\n${candidates.map(c => `• ${c.name} — ${c.reasons.join(" + ")}`).join("\n")}`
    }
  );

  const message = `Offboarding sweep: marked ${candidates.length} of ${liveRows} live row(s) as ${WFO_EXEMPT_COLUMN}.`;
  Logger.log(message);
  return {
    success: true, marked: candidates.length, checked: liveRows,
    slackChecked: directory.ok, names: candidates.map(candidate => candidate.name), message: message
  };
}

/** Dry run: logs who would be marked and why, writes nothing. */
function previewExitedEmployees() {
  return markExitedEmployees({ dryRun: true });
}

/**
 * Same sweep with the mass-exit guard switched off.
 *
 * It exists as its own function because the Apps Script editor's Run button
 * calls with no arguments — there is no way to type
 * markExitedEmployees({ force: true }) there. Run previewExitedEmployees()
 * FIRST and read the list: this marks everyone on it, however many that is.
 *
 * The expected use is the first run on a sheet that has accumulated months of
 * leavers, where tripping the guard is correct behaviour rather than a fault.
 */
function forceMarkExitedEmployees() {
  return markExitedEmployees({ force: true });
}

/**
 * The whole Slack member directory in one paginated read, as
 * { ok, byEmail: {email: {id, deleted}}, byId: {id: {email, deleted}} }.
 *
 * users.list rather than users.info per row: the Log is ~350 rows and this is
 * two or three requests instead of 350. Never throws — `ok: false` just means
 * the Zoho signal runs on its own, which is the right way for a Slack outage to
 * degrade.
 */
function fetchSlackDirectory_() {
  const byEmail = {};
  const byId = {};
  let cursor = "";
  let pages = 0;

  try {
    do {
      const url = "https://slack.com/api/users.list?limit=" + SLACK_DIRECTORY_PAGE_SIZE +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const response = UrlFetchApp.fetch(url, {
        method: "get",
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        muteHttpExceptions: true
      });
      const json = JSON.parse(response.getContentText());
      if (!json.ok) {
        Logger.log(`users.list failed: ${json.error} — continuing on the Zoho signal alone`);
        return { ok: false, byEmail: byEmail, byId: byId };
      }

      (json.members || []).forEach(member => {
        if (member.is_bot || member.id === "USLACKBOT") return;
        const email = member.profile && member.profile.email
          ? member.profile.email.toString().trim().toLowerCase()
          : "";
        const entry = { id: member.id, email: email, deleted: member.deleted === true };
        byId[member.id] = entry;
        if (email) byEmail[email] = entry;
      });

      cursor = json.response_metadata && json.response_metadata.next_cursor
        ? json.response_metadata.next_cursor
        : "";
      pages++;
      if (cursor) Utilities.sleep(1200); // Tier 2, ~20 req/min
    } while (cursor && pages < SLACK_DIRECTORY_MAX_PAGES);

    const deactivated = Object.keys(byId).filter(id => byId[id].deleted).length;
    Logger.log(`Slack directory: ${Object.keys(byId).length} member(s) over ${pages} page(s), ${deactivated} deactivated.`);
    return { ok: true, byEmail: byEmail, byId: byId };
  } catch (error) {
    Logger.log(`Slack directory read failed: ${error.message} — continuing on the Zoho signal alone`);
    return { ok: false, byEmail: byEmail, byId: byId };
  }
}

/**
 * Wrapper for callers that must not fail because of this: logs and alerts, but
 * never throws. Used by the employee sync and by the fortnightly summary run.
 */
function markExitedEmployeesBestEffort_(options) {
  try {
    return markExitedEmployees(options);
  } catch (error) {
    Logger.log(`Offboarding sweep skipped: ${error.message}`);
    sendErrorAlert(
      `Offboarding sweep failed — leavers may still be prompted and may still appear in attendance summaries: ${error.message}`,
      { functionName: "markExitedEmployeesBestEffort_" }
    );
    return { success: false, marked: 0, message: error.message };
  }
}
