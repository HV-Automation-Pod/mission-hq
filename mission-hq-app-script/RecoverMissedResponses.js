/**
 * Recover attendance responses that the user actually submitted in Slack but
 * that never made it into the MissionHQ Log (cell still says "Pending").
 *
 * Why this exists
 * ---------------
 * The submit path is: Slack -> Supabase edge function -> (1) chat.update
 * confirmation, (2) Slack profile status, (3) POST to Apps Script doPost ->
 * updateLocationByEmailID writes one cell.
 *
 * Step (1) runs BEFORE step (3) and nothing retries step (3). So any failure in
 * the Apps Script leg — the edge isolate being torn down before the background
 * task finishes, an Apps Script concurrency/quota error during the post-prompt
 * submit burst, a Spreadsheet contention error inside doPost, or a
 * updateLocationByEmailID that returns success:false — leaves the user looking
 * at "Thank you for your update! We received your response ... " while the sheet
 * still reads "Pending". That is exactly the reported glitch.
 *
 * The Slack DM is therefore the source of truth for what the user answered.
 * This script re-reads it.
 *
 * Two entry points
 * ----------------
 *   previewMissedResponses()   dry run  - logs only, writes NOTHING
 *   fixMissedResponses()       real run - writes the recovered value into the cell
 *
 * Both do the same scan:
 *   1. Walk the MissionHQ Log for cells that say "Pending" in a date column.
 *   2. For each such employee, open their DM with the bot and read its history.
 *   3. Look for a confirmation message "... We received your response *X* for
 *      <date>." matching that Pending date.
 *   4. If found, the user DID answer -> map the label back to a sheet value.
 *   5. Cross-check the DUMP sheet to classify WHERE the write was lost, so the
 *      root cause is evidenced rather than guessed.
 *
 * Both are safe to re-run. The scan is long (Slack rate limits + the 6-minute
 * Apps Script cap), so it checkpoints its progress in a script property and
 * resumes from there on the next run. Run it repeatedly until it reports
 * "scan complete".
 *
 * Needs the bot scopes im:write (conversations.open) and im:history
 * (conversations.history) — the same pair the one-off confirmation backfill used.
 */

// Resume checkpoint: the last MissionHQ Log row index already scanned.
const MISSED_SCAN_CURSOR_PROPERTY = "MISSED_RESPONSE_SCAN_ROW";

// Stop and checkpoint before Apps Script's 6-minute execution cap kills the run.
const MISSED_SCAN_TIME_BUDGET_MS = 4.5 * 60 * 1000;

// conversations.history is Tier 3 (~50 req/min). Pace one user per ~1.2s.
const MISSED_SCAN_SLACK_PAUSE_MS = 1200;

// Max conversations.history pages (200 messages each) per user.
const MISSED_SCAN_MAX_HISTORY_PAGES = 6;

// How many trailing DUMP rows to index for the root-cause classification.
const MISSED_SCAN_DUMP_ROWS = 30000;

// "Thank you for your update! We received your response *<label>* for <date>."
// The label group is optional — a confirmation built without a resolvable label
// still names its date, which is enough to prove the user answered.
const MISSED_SCAN_CONFIRMATION_RE =
  /We received your response\s*(?:\*([^*]+)\*)?\s*for\s+(\d{4}-\d{2}-\d{2})/;

// Days back the daily self-healing sweep looks. Small on purpose: it must
// finish inside one Apps Script execution, and anything older is caught by a
// manual previewMissedResponses()/fixMissedResponses() run.
const MISSED_SCAN_SWEEP_DAYS = 4;

// doPost's own DUMP breadcrumbs.
const MISSED_SCAN_DUMP_REQUEST_RE =
  /Sheet write request:\s*email=(.*?),\s*date=(.*?),\s*status=(.*)$/;
const MISSED_SCAN_DUMP_RESULT_RE =
  /Sheet write result for\s*(.*?):\s*(\{[\s\S]*\})$/;

/**
 * DRY RUN. Finds every "Pending" cell whose owner actually answered in Slack and
 * logs it. Writes nothing to the sheet.
 *
 * @param {string} [fromDate] optional yyyy-MM-dd lower bound on the date columns.
 * @param {string} [toDate]   optional yyyy-MM-dd upper bound on the date columns.
 */
function previewMissedResponses(fromDate, toDate) {
  return runMissedResponseScan_({ dryRun: true, fromDate: fromDate, toDate: toDate });
}

/**
 * REAL RUN. Same scan, but writes the recovered status into each Pending cell
 * and leaves a note on the cell recording where the value came from.
 *
 * @param {string} [fromDate] optional yyyy-MM-dd lower bound on the date columns.
 * @param {string} [toDate]   optional yyyy-MM-dd upper bound on the date columns.
 */
function fixMissedResponses(fromDate, toDate) {
  return runMissedResponseScan_({ dryRun: false, fromDate: fromDate, toDate: toDate });
}

/**
 * DAILY SAFETY NET — wire this to a time-based trigger (see
 * createMissedResponseSweepTrigger).
 *
 * Re-checks only the last few days, silently repairs any response that Slack
 * confirmed but the sheet lost, and posts to #automation-alerts whenever it had
 * to repair something. This is what turns a silent data loss into a visible one:
 * whatever
 * breaks in the chain — the edge function's forward, doPost dying mid-write, or
 * a stale-snapshot overwrite — the sweep catches it the next morning and says so.
 *
 * It deliberately ignores the resume cursor: it is a bounded daily job, not the
 * full historical backfill.
 */
function dailyMissedResponseSweep() {
  const from = new Date();
  from.setDate(from.getDate() - MISSED_SCAN_SWEEP_DAYS);
  const fromDate = Utilities.formatDate(from, "Asia/Kolkata", "yyyy-MM-dd");

  let result;
  try {
    result = runMissedResponseScan_({ dryRun: false, fromDate: fromDate, ignoreCursor: true });
  } catch (error) {
    // A sweep that cannot run is itself worth an alert — otherwise the safety
    // net fails silently, which is the exact problem it exists to solve.
    sendErrorAlert(`Attendance recovery sweep failed to run: ${error.message}`, {
      functionName: 'dailyMissedResponseSweep',
      sheetName: CANDIDATE_SHEET_NAME,
      additionalInfo:
        'Responses confirmed in Slack may be missing from the sheet and are NOT being repaired.',
    });
    throw error;
  }

  if (result.written > 0 || result.unrecoverable > 0) {
    sendErrorAlert(
      `Recovered ${result.written} attendance response(s) that were lost after the user was told they were saved`,
      {
        functionName: 'dailyMissedResponseSweep',
        sheetName: CANDIDATE_SHEET_NAME,
        additionalInfo: buildSweepAlert_(result, fromDate),
      }
    );
  }

  // A sweep that ran out of time covered only part of the sheet. Staying quiet
  // about that would recreate the very failure this job exists to catch: it
  // would look like "nothing to repair" when it is really "did not finish
  // looking". There is no cursor to resume from here, so say so out loud.
  if (!result.complete) {
    sendErrorAlert('Attendance recovery sweep ran out of time and did NOT finish', {
      functionName: 'dailyMissedResponseSweep',
      sheetName: CANDIDATE_SHEET_NAME,
      additionalInfo:
        `Checked up to sheet row ${result.lastRow} of ${result.totalRows}; rows after that were ` +
        `not swept today. Anything lost below that row is still \`Pending\`. ` +
        `Run \`fixMissedResponses('${fromDate}')\` to finish the job.`,
    });
  }

  return result;
}

/** Creates the daily trigger for dailyMissedResponseSweep(). Run once. */
function createMissedResponseSweepTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "dailyMissedResponseSweep") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("dailyMissedResponseSweep")
    .timeBased()
    .atHour(20) // well after the day's prompts, reminders and submissions
    .everyDays(1)
    .create();
  Logger.log("Daily missed-response sweep trigger created for ~20:00 IST.");
}

function buildSweepAlert_(result, fromDate) {
  const lines = [
    `These people answered in Slack but the sheet still said \`Pending\`. Restored from their DM confirmation.`,
    ""
  ];

  result.repaired.forEach(item => {
    lines.push(`• *${item.name || item.email}* — ${item.date} → \`${item.value}\`  _(answered ${item.confirmedAt}; lost at: ${item.verdict})_`);
  });

  if (result.unrecoverable > 0) {
    lines.push("");
    lines.push(`${result.unrecoverable} more answered but their confirmation did not record *what* they picked — those are still \`Pending\` and need a manual ask.`);
  }

  lines.push("");
  lines.push(`_Scanned ${fromDate} onward. Recovery is automatic; this alert exists so the underlying failure does not stay invisible._`);
  return lines.join("\n");
}

/**
 * Lists every trigger with its handler and schedule.
 *
 * Both processEmailsAndSendSlackMessage() and
 * processPendingEmailsAndSendSlackReminder() write setValue("Pending") from a
 * snapshot taken at the start of a multi-minute loop, so either can overwrite an
 * answer that arrives mid-run. Which one is actually doing it is decided purely
 * by what time each trigger fires relative to when people answer (~10:18-10:26).
 */
function logAttendanceTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`${triggers.length} trigger(s):`);
  triggers.forEach(trigger => {
    let when = "";
    try {
      when = trigger.getTriggerSource() === ScriptApp.TriggerSource.CLOCK
        ? `clock, ~${trigger.getTriggerSourceId() || "see Triggers UI for the hour"}`
        : trigger.getTriggerSource().toString();
    } catch (e) {
      when = "unknown";
    }
    Logger.log(`  ${trigger.getHandlerFunction()}  (${trigger.getEventType()}, ${when})`);
  });
  Logger.log("Cross-check the firing hour of each in Triggers UI against 10:18-10:26 IST.");
  return triggers.length;
}

/** Clears the resume checkpoint so the next run starts from the first row. */
function resetMissedResponseScan() {
  PropertiesService.getScriptProperties().deleteProperty(MISSED_SCAN_CURSOR_PROPERTY);
  Logger.log("Missed-response scan cursor cleared — the next run starts from row 2.");
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function runMissedResponseScan_(options) {
  const started = Date.now();
  const dryRun = options.dryRun !== false;
  const mode = dryRun ? "PREVIEW (no writes)" : "FIX (writing to sheet)";

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(h => h.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  const nameColIndex = headers.indexOf("Full Name");
  const slackIdColIndex = headers.indexOf(SLACK_USER_ID_COLUMN);
  if (emailColIndex === -1 || nameColIndex === -1) {
    throw new Error("Required columns (Full Name, Email Address) not found");
  }

  const dateColumns = collectDateColumns_(headers, options.fromDate, options.toDate);
  if (dateColumns.length === 0) {
    Logger.log("No date columns in range — nothing to scan.");
    return { success: true, scanned: 0, recovered: 0 };
  }

  // Duplicate date columns are their own failure mode: ProcessData matches the
  // header by display text while updateLocationByEmailID matches it by parsing
  // the value. When those two disagree the prompt flow inserts a SECOND column
  // for the same day, then writes "Pending" into the new one while the submit
  // path writes the real answer into the first one it finds — reporting
  // success:true over a cell the sheet never shows.
  const columnsByDate = {};
  dateColumns.forEach(col => {
    if (!columnsByDate[col.date]) columnsByDate[col.date] = [];
    columnsByDate[col.date].push(col.index);
  });
  const duplicateDates = Object.keys(columnsByDate).filter(d => columnsByDate[d].length > 1).sort();

  const labelMap = buildLocationLabelMap_();
  const dumpIndex = buildDumpIndex_();

  const props = PropertiesService.getScriptProperties();
  const startRow = options.ignoreCursor
    ? 1
    : parseInt(props.getProperty(MISSED_SCAN_CURSOR_PROPERTY) || "1", 10);

  Logger.log("=".repeat(78));
  Logger.log(`Missed-response scan — ${mode}`);
  Logger.log(`Date columns in scope: ${dateColumns.length} (${dateColumns[dateColumns.length - 1].date} .. ${dateColumns[0].date})`);
  Logger.log(`Resuming from data row ${startRow + 1} of ${data.length - 1}`);
  Logger.log(`DUMP index: ${dumpIndex.size} write events, oldest entry ${dumpIndex.windowStart || "n/a"}`);
  if (duplicateDates.length) {
    Logger.log(`!! ${duplicateDates.length} date(s) have MORE THAN ONE column in the sheet:`);
    duplicateDates.forEach(date => {
      const letters = columnsByDate[date].map(i => columnLetter_(i + 1)).join(", ");
      Logger.log(`   ${date} -> columns ${letters}`);
    });
  } else {
    Logger.log("No duplicate date columns.");
  }
  Logger.log("=".repeat(78));

  const findings = [];
  const byDate = {};
  const byHour = {};
  const byVerdict = {};
  let usersChecked = 0;
  let pendingCells = 0;
  let unanswered = 0;
  let timedOut = false;
  let lastRow = startRow;

  for (let i = Math.max(startRow, 1); i < data.length; i++) {
    lastRow = i;

    if (Date.now() - started > MISSED_SCAN_TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const row = data[i];
    const email = (row[emailColIndex] || "").toString().trim();
    const name = (row[nameColIndex] || "").toString().trim();
    if (!email) continue;

    // Only the cells that are actually stuck on "Pending".
    const pending = dateColumns
      .filter(col => (row[col.index] || "").toString().trim() === "Pending")
      .map(col => ({ date: col.date, index: col.index }));
    if (pending.length === 0) continue;
    pendingCells += pending.length;

    let slackId = slackIdColIndex !== -1 ? (row[slackIdColIndex] || "").toString().trim() : "";
    if (!slackId) {
      const userInfo = getUserInfoByEmail(email);
      slackId = userInfo && userInfo.id ? userInfo.id : "";
    }
    if (!slackId) {
      Logger.log(`row ${i + 1} ${email}: no Slack user id — skipped`);
      continue;
    }

    const oldestDate = pending[pending.length - 1].date;
    const confirmations = readDmConfirmations_(slackId, oldestDate);
    usersChecked++;

    if (!confirmations.ok) {
      Logger.log(`row ${i + 1} ${email}: DM read failed (${confirmations.error}) — skipped`);
      Utilities.sleep(MISSED_SCAN_SLACK_PAUSE_MS);
      continue;
    }

    for (let p = 0; p < pending.length; p++) {
      const cell = pending[p];
      const hit = confirmations.byDate[cell.date];
      if (!hit) {
        unanswered++;
        continue; // genuinely never answered — leave it Pending
      }

      const resolved = resolveLabelToSheetValue_(hit.label, labelMap);
      const confirmedAt = formatSlackTs_(hit.ts);

      // Did the answer land in a DUPLICATE column for the same date? If so the
      // write never failed at all — it went to a column the sheet's own prompt
      // flow no longer considers canonical.
      const sibling = findSiblingValue_(row, columnsByDate[cell.date], cell.index);
      const verdict = sibling
        ? {
            code: "WRITTEN_TO_DUPLICATE_COLUMN",
            detail: `The same date also exists in column ${columnLetter_(sibling.index + 1)}, which holds "${sibling.value}".`
          }
        : classifyLoss_(dumpIndex, email, cell.date);

      const finding = {
        sheetRow: i + 1,
        col: cell.index + 1,
        name: name,
        email: email,
        date: cell.date,
        label: hit.label || "(no label in message)",
        value: resolved.value,
        confirmedAt: confirmedAt,
        verdict: verdict.code,
        verdictDetail: verdict.detail,
        written: false
      };

      byDate[cell.date] = (byDate[cell.date] || 0) + 1;
      const hour = confirmedAt ? confirmedAt.slice(11, 13) : "??";
      byHour[hour] = (byHour[hour] || 0) + 1;
      byVerdict[verdict.code] = (byVerdict[verdict.code] || 0) + 1;

      if (!resolved.value) {
        // NO_LABEL_IN_MESSAGE is not a bug: confirmations sent before the label
        // was added to the text simply do not record what was answered, so
        // there is nothing to recover. UNKNOWN_LABEL is a real gap worth
        // chasing in the Locations tab.
        finding.unrecoverable = resolved.reason;
        Logger.log(
          `MISSED  row ${i + 1}  ${cell.date}  ${email}  answered "${finding.label}" at ${confirmedAt}` +
          `  -> NOT RECOVERABLE: ${resolved.reason} (left as Pending)  [${verdict.code}]`
        );
        findings.push(finding);
        continue;
      }

      if (!dryRun) {
        // Re-read the live cell: something may have filled it since the snapshot.
        const range = sheet.getRange(i + 1, cell.index + 1);
        const live = range.getDisplayValue().toString().trim();
        if (live !== "Pending") {
          Logger.log(`row ${i + 1} ${cell.date} ${email}: no longer Pending (now "${live}") — left alone`);
          continue;
        }
        range.setValue(resolved.value);
        range.setNote(
          `Recovered from the Slack DM confirmation (answered ${confirmedAt}).\n` +
          `Label: ${finding.label}\nBackfilled by fixMissedResponses().`
        );
        finding.written = true;
        logToDumpSheet(
          `Recovered missed response: ${email} ${cell.date} -> ${resolved.value} ` +
          `(confirmed in Slack at ${confirmedAt}, loss=${verdict.code})`
        );
      }

      Logger.log(
        `${dryRun ? "WOULD SET" : "SET      "}  row ${i + 1}  ${cell.date}  ${email}` +
        `  "${finding.label}" -> "${resolved.value}"  (answered ${confirmedAt})  [${verdict.code}]`
      );
      findings.push(finding);
    }

    Utilities.sleep(MISSED_SCAN_SLACK_PAUSE_MS);
  }

  const complete = !timedOut;
  if (!options.ignoreCursor) {
    if (complete) {
      props.deleteProperty(MISSED_SCAN_CURSOR_PROPERTY);
    } else {
      props.setProperty(MISSED_SCAN_CURSOR_PROPERTY, lastRow.toString());
    }
  }

  if (!dryRun) SpreadsheetApp.flush();

  logMissedResponseSummary_({
    mode: mode,
    dryRun: dryRun,
    complete: complete,
    lastRow: lastRow,
    totalRows: data.length - 1,
    usersChecked: usersChecked,
    pendingCells: pendingCells,
    unanswered: unanswered,
    findings: findings,
    byDate: byDate,
    byHour: byHour,
    byVerdict: byVerdict,
    dumpWindowStart: dumpIndex.windowStart
  });

  const repaired = findings.filter(f => f.written);
  return {
    success: true,
    dryRun: dryRun,
    complete: complete,
    pendingCells: pendingCells,
    missed: findings.length,
    unanswered: unanswered,
    written: repaired.length,
    repaired: repaired,
    lastRow: lastRow,
    totalRows: data.length - 1,
    // Answered in Slack, but the confirmation never recorded which option —
    // nothing to restore, so a human has to ask them.
    unrecoverable: findings.filter(f => f.unrecoverable).length
  };
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

/**
 * Every header that is a date, newest first, optionally clamped to a range.
 * Headers are read as display values, so both "2026-08-10" and a locale-
 * formatted date cell resolve to the same yyyy-MM-dd key.
 */
function collectDateColumns_(headers, fromDate, toDate) {
  const columns = [];
  for (let i = 0; i < headers.length; i++) {
    const date = normalizeDateHeader_(headers[i]);
    if (!date) continue;
    if (fromDate && date < fromDate) continue;
    if (toDate && date > toDate) continue;
    columns.push({ index: i, date: date });
  }
  // Date columns are inserted newest-first, but sort explicitly so the "oldest
  // pending date" used as the Slack history floor is always correct.
  columns.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return columns;
}

/**
 * When a date has more than one column, returns the first sibling column that
 * holds a real answer for this row — evidence the write succeeded but landed
 * somewhere the sheet no longer treats as that day's column.
 */
function findSiblingValue_(row, columnIndexes, currentIndex) {
  if (!columnIndexes || columnIndexes.length < 2) return null;
  for (let i = 0; i < columnIndexes.length; i++) {
    const index = columnIndexes[i];
    if (index === currentIndex) continue;
    const value = (row[index] || "").toString().trim();
    if (value && value !== "Pending") return { index: index, value: value };
  }
  return null;
}

function columnLetter_(columnNumber) {
  let letter = "";
  let n = columnNumber;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function normalizeDateHeader_(header) {
  const text = (header || "").toString().trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Anything else only counts if it genuinely parses as a date — plain labels
  // like "Full Name" or "Date" must not slip through.
  if (!/\d/.test(text)) return null;
  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) return null;
  return Utilities.formatDate(parsed, "Asia/Kolkata", "yyyy-MM-dd");
}

/**
 * Slack sends back the option's display label (with emoji), not its value.
 * Build display-label -> sheet value using the same Locations tab the dropdown
 * was built from, so the recovered value is byte-identical to what the live
 * path would have written.
 */
function buildLocationLabelMap_() {
  const map = { byLabel: {}, byValue: {} };
  const locations = getLocationsList();
  locations.forEach(item => {
    const value = (item.value || "").toString().trim().replace(/\s+/g, "-");
    if (!value) return;
    const sheetValue = formatLocationValueForSheet_(value);
    map.byLabel[normalizeLabel_(item.location)] = sheetValue;
    map.byValue[normalizeLabel_(value)] = sheetValue;
    map.byValue[normalizeLabel_(sheetValue)] = sheetValue;
  });
  return map;
}

/**
 * Locations tab labels carry literal emoji ("🏢 Office – Full Day") but
 * conversations.history returns them as shortcodes (":office: Office – Full
 * Day"). Strip the shortcodes first, otherwise their letters ("office") leak
 * into the key and nothing ever matches. Everything that is not a-z0-9 is then
 * dropped, which also removes literal emoji, en-dashes and spacing differences.
 */
function normalizeLabel_(text) {
  return (text || "")
    .toString()
    .replace(/:[a-z0-9_+\-']+:/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveLabelToSheetValue_(label, labelMap) {
  if (!label) return { value: "", reason: "NO_LABEL_IN_MESSAGE" };
  const key = normalizeLabel_(label);
  if (labelMap.byLabel[key]) return { value: labelMap.byLabel[key], reason: "" };
  if (labelMap.byValue[key]) return { value: labelMap.byValue[key], reason: "" };
  return { value: "", reason: `UNKNOWN_LABEL (normalized: "${key}")` };
}

// ---------------------------------------------------------------------------
// Slack DM reading
// ---------------------------------------------------------------------------

/**
 * Opens the bot<->user DM and reads back every confirmation message, keyed by
 * the date named inside the message text (not by the message timestamp — a
 * backfilled prompt is answered on a different day than it is for).
 *
 * The newest confirmation for a date wins, so a user who resubmitted gets their
 * latest answer.
 */
function readDmConfirmations_(slackUserId, oldestDate) {
  const channel = openDmChannel_(slackUserId);
  if (!channel.ok) return { ok: false, error: channel.error };

  const oldestTs = Math.floor(new Date(`${oldestDate}T00:00:00+05:30`).getTime() / 1000);
  const byDate = {};
  let cursor = "";

  for (let page = 0; page < MISSED_SCAN_MAX_HISTORY_PAGES; page++) {
    let url =
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel.id)}` +
      `&limit=200&oldest=${oldestTs}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const json = slackGet_(url);
    if (!json.ok) return { ok: false, error: json.error || "history_failed" };

    (json.messages || []).forEach(message => {
      const text = (message.text || "").toString();

      const match = text.match(MISSED_SCAN_CONFIRMATION_RE);
      if (!match) return;
      const date = match[2];
      const label = (match[1] || "").trim();
      const ts = parseFloat(message.ts || "0");
      // Keep the newest confirmation per date.
      if (!byDate[date] || ts > byDate[date].ts) {
        byDate[date] = { label: label, ts: ts };
      }
    });

    cursor = (json.response_metadata && json.response_metadata.next_cursor) || "";
    if (!json.has_more || !cursor) break;
  }

  return { ok: true, byDate: byDate, channel: channel.id };
}

function openDmChannel_(slackUserId) {
  const response = slackPost_("https://slack.com/api/conversations.open", { users: slackUserId });
  if (!response.ok || !response.channel || !response.channel.id) {
    return { ok: false, error: response.error || "conversations_open_failed" };
  }
  return { ok: true, id: response.channel.id };
}

/** GET with one Retry-After-aware retry on 429. */
function slackGet_(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 429) {
      const wait = parseInt(response.getHeaders()["Retry-After"] || "5", 10);
      Logger.log(`Slack rate limited — sleeping ${wait}s`);
      Utilities.sleep((wait + 1) * 1000);
      continue;
    }
    try {
      return JSON.parse(response.getContentText());
    } catch (e) {
      return { ok: false, error: `bad_json: ${e.message}` };
    }
  }
  return { ok: false, error: "rate_limited" };
}

/** POST with one Retry-After-aware retry on 429. */
function slackPost_(url, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 429) {
      const wait = parseInt(response.getHeaders()["Retry-After"] || "5", 10);
      Logger.log(`Slack rate limited — sleeping ${wait}s`);
      Utilities.sleep((wait + 1) * 1000);
      continue;
    }
    try {
      return JSON.parse(response.getContentText());
    } catch (e) {
      return { ok: false, error: `bad_json: ${e.message}` };
    }
  }
  return { ok: false, error: "rate_limited" };
}

function formatSlackTs_(ts) {
  if (!ts) return "";
  return Utilities.formatDate(new Date(ts * 1000), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
}

// ---------------------------------------------------------------------------
// Root cause: where in the chain was the write lost?
// ---------------------------------------------------------------------------

/**
 * doPost logs one "Sheet write request:" line the moment it is invoked and one
 * "Sheet write result for <email>: {...}" line after updateLocationByEmailID
 * returns. Indexing those two breadcrumbs tells us which leg of the chain
 * dropped the response — the edge function never reached Apps Script, or it did
 * and the sheet write itself failed.
 */
function buildDumpIndex_() {
  const index = {
    requests: {},
    results: {},
    size: 0,
    windowStart: "",
    get: function (email, date) {
      const key = `${(email || "").toLowerCase()}|${date}`;
      return { request: this.requests[key], result: this.results[key] };
    }
  };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DUMP");
  if (!sheet) {
    Logger.log("DUMP sheet not found — loss classification will be unavailable.");
    return index;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return index;

  const rowCount = Math.min(lastRow - 1, MISSED_SCAN_DUMP_ROWS);
  const firstRow = lastRow - rowCount + 1;
  const values = sheet.getRange(firstRow, 1, rowCount, 2).getValues();

  if (values.length && values[0][0]) {
    const first = values[0][0];
    index.windowStart = first instanceof Date
      ? Utilities.formatDate(first, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss")
      : first.toString();
  }

  // The result line carries no date, so it is paired with the most recent
  // request logged for the same email. Last write wins, so `results` reflects
  // the final outcome for that email/date.
  const lastRequestKeyByEmail = {};
  values.forEach(row => {
    const message = (row[1] || "").toString();
    if (!message) return;

    const request = message.match(MISSED_SCAN_DUMP_REQUEST_RE);
    if (request) {
      const email = request[1].trim().toLowerCase();
      const key = `${email}|${request[2].trim()}`;
      index.requests[key] = { status: request[3].trim(), at: row[0] };
      lastRequestKeyByEmail[email] = key;
      index.size++;
      return;
    }

    const result = message.match(MISSED_SCAN_DUMP_RESULT_RE);
    if (result) {
      const email = result[1].trim().toLowerCase();
      const key = lastRequestKeyByEmail[email];
      if (key) index.results[key] = result[2];
    }
  });

  return index;
}

function classifyLoss_(dumpIndex, email, date) {
  const hit = dumpIndex.get ? dumpIndex.get(email, date) : { request: null, result: null };

  if (!hit.request) {
    return {
      code: "NEVER_REACHED_APPS_SCRIPT",
      detail:
        "No doPost breadcrumb in DUMP. The edge function updated the Slack " +
        "message but its background forward to Apps Script never landed."
    };
  }

  if (hit.result && /"success"\s*:\s*true/.test(hit.result)) {
    return {
      code: "WRITE_REPORTED_OK_BUT_CELL_PENDING",
      detail: `doPost reported success yet the cell is Pending: ${hit.result}`
    };
  }

  if (hit.result) {
    return {
      code: "SHEET_WRITE_FAILED",
      detail: `doPost ran and the sheet write failed: ${hit.result}`
    };
  }

  return {
    code: "APPS_SCRIPT_DIED_MID_WRITE",
    detail:
      "doPost logged the incoming request but never logged a result — the " +
      "execution was killed or threw before updateLocationByEmailID returned."
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function logMissedResponseSummary_(report) {
  const line = "-".repeat(78);
  Logger.log(line);
  Logger.log(`SUMMARY — ${report.mode}`);
  Logger.log(line);
  Logger.log(`Rows scanned this run       : up to data row ${report.lastRow} of ${report.totalRows}`);
  Logger.log(`Scan status                 : ${report.complete ? "COMPLETE" : "PAUSED — run again to resume"}`);
  Logger.log(`Employees with Pending cells: ${report.usersChecked}`);
  Logger.log(`Pending cells inspected     : ${report.pendingCells}`);
  Logger.log(`Confirmed missed responses  : ${report.findings.length}`);
  Logger.log(`Genuinely never answered    : ${report.unanswered}`);
  if (!report.dryRun) {
    Logger.log(`Cells written               : ${report.findings.filter(f => f.written).length}`);
  }

  const recoverable = report.findings.filter(f => f.value);
  const noLabel = report.findings.filter(f => f.unrecoverable === "NO_LABEL_IN_MESSAGE");
  const unknownLabel = report.findings.filter(f => f.unrecoverable && f.unrecoverable !== "NO_LABEL_IN_MESSAGE");
  Logger.log(`  of which recoverable      : ${recoverable.length}`);
  Logger.log(`  old format, no label      : ${noLabel.length} (nothing to recover — confirmation never named the answer)`);
  if (unknownLabel.length) {
    Logger.log(`  label not in Locations tab: ${unknownLabel.length} (investigate)`);
    unknownLabel.forEach(f => Logger.log(`      ${f.date} ${f.email} ${f.unrecoverable}`));
  }

  Logger.log(line);
  Logger.log("Missed responses by date (which days lost data):");
  Object.keys(report.byDate).sort().forEach(date => {
    Logger.log(`  ${date}  ${"#".repeat(Math.min(report.byDate[date], 60))} ${report.byDate[date]}`);
  });

  Logger.log(line);
  Logger.log("Missed responses by submit hour, IST (tests the burst/concurrency theory):");
  Object.keys(report.byHour).sort().forEach(hour => {
    Logger.log(`  ${hour}:00  ${"#".repeat(Math.min(report.byHour[hour], 60))} ${report.byHour[hour]}`);
  });

  Logger.log(line);
  Logger.log("Where the write was lost (root-cause evidence from the DUMP sheet):");
  Logger.log(`  DUMP index reaches back to: ${report.dumpWindowStart || "n/a"}`);
  Object.keys(report.byVerdict).forEach(code => {
    Logger.log(`  ${code}: ${report.byVerdict[code]}`);
  });
  Logger.log(line);
  Logger.log("Verdict key:");
  Logger.log("  NEVER_REACHED_APPS_SCRIPT          edge function never delivered the POST");
  Logger.log("  APPS_SCRIPT_DIED_MID_WRITE         doPost started, never finished");
  Logger.log("  SHEET_WRITE_FAILED                 doPost ran, updateLocationByEmailID returned an error");
  Logger.log("  WRITE_REPORTED_OK_BUT_CELL_PENDING write claimed success but the cell says Pending");
  Logger.log("  WRITTEN_TO_DUPLICATE_COLUMN        the answer is in another column for the same date");
  Logger.log(line);

  if (report.dryRun && report.findings.length) {
    Logger.log("Dry run — nothing was written. Run fixMissedResponses() to apply these.");
  }
}
