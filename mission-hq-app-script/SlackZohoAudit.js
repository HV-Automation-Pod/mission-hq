// ---------------------------------------------------------------------------
// Slack vs Zoho reconciliation — who has a live Slack account that the HRIS
// does not know about.
//
// The offboarding sweep (Offboarding.js) answers a narrower question: of the
// people already IN the MissionHQ Log, who has left? It can only ever see rows
// the Log already has, so somebody who never made it into the Log — a Slack
// account created for a contractor, a hire Zoho records under a different
// email, a shared mailbox — is invisible to it. Suryaprakash P was caught
// because he had a Log row; nobody without one would be.
//
// This is the other direction: every active full MEMBER of the Slack workspace
// whose email the Zoho org tree does not contain, written to a "Slack vs Zoho"
// tab and re-checked daily off the back of the employee sync.
//
// Deliberately a report, not a sweep. The offboarding signal ("absent from
// Zoho" == no longer employed) is only safe against the Log, where every row
// was put there by the Zoho sync in the first place. Against the raw Slack
// directory the same rule would flag anyone whose Zoho email differs from their
// Slack one — so this writes a tab for a human to triage and changes nothing
// else.
//
// THE TAB IS AN INPUT AS WELL AS AN OUTPUT. Each run merges into it rather than
// rewriting it: the machine columns are refreshed, the two human columns
// (SLACK_AUDIT_MANUAL_HEADERS) are preserved exactly as typed, and rows are
// matched by Slack user id so a renamed or re-emailed account keeps its answer.
// A full rewrite would throw away the decision the report exists to collect.
// ---------------------------------------------------------------------------

const SLACK_AUDIT_SHEET_NAME = "Slack vs Zoho";

// Only full members are reconciled against the HRIS. The workspace carries
// ~130 Slack Connect guests on gmail.com, fairmoney.io, starsquaredpr.com and
// the like — vendors, agencies and partners who will never be in Zoho and are
// not supposed to be. Reporting them buried the dozen company accounts that
// genuinely need explaining.
const SLACK_AUDIT_MEMBERS_ONLY = true;

// Written by hand, never by this script. Matched by HEADER NAME, so inserting
// or reordering columns on the tab cannot make the sync overwrite them.
const SLACK_AUDIT_PROMPT_HEADER = "Send Attendance Prompt?";
const SLACK_AUDIT_NOTES_HEADER = "Notes";
const SLACK_AUDIT_MANUAL_HEADERS = [SLACK_AUDIT_PROMPT_HEADER, SLACK_AUDIT_NOTES_HEADER];

// Display name, Slack user id and account type are deliberately NOT on the tab.
// Every row is a full member by construction, so the type column only ever read
// "Member", and the id is machine detail nobody triaging the list needs. They
// are still computed — the id addresses the Slack API, the type explains why a
// row later stops being reported — they just do not take up a column.
const SLACK_AUDIT_HEADERS = [
  "Slack Name",
  "Email",
  "In MissionHQ Log",
  "WFO Exempt",
  "Possible Zoho Match (by name)",
  SLACK_AUDIT_PROMPT_HEADER,
  SLACK_AUDIT_NOTES_HEADER,
  "Status",
  "First Seen",
  "Last Checked"
];

// The row key, and therefore what a preserved answer is attached to. The Slack
// user id would survive an email change where this does not — but it is not on
// the tab, and a silent key is worse than a visible one: with the email as the
// key, a row whose address changed comes back as New and gets looked at, which
// for a report about email mismatches is the right outcome rather than a bug.
const SLACK_AUDIT_KEY_HEADER = "Email";

const SLACK_AUDIT_STATUS_NEW = "New";
const SLACK_AUDIT_STATUS_OPEN = "Open";

/**
 * Reconciles the Slack member list against the Zoho org tree and merges the
 * result into the "Slack vs Zoho" tab. Alerts #automation-alerts only when
 * somebody NEW shows up — a daily job that reposts the same list is a daily job
 * nobody reads.
 *
 * @param {Object} [options]
 * @param {Array<Object>} [options.employees]  org-tree payload, when the caller
 *        already has one (the employee sync does). Omitted → fetched here.
 * @param {boolean} [options.dryRun]  log everything, write nothing, alert nothing.
 */
function auditSlackAccountsNotInZoho(options) {
  options = options || {};
  const dryRun = options.dryRun === true;

  const employees = options.employees || fetchZohoOrgTreeEmployees_();
  if (!employees.length) {
    // An empty payload would make the entire company look missing from Zoho.
    throw new Error("Org-tree returned no employees — refusing to report everyone as missing");
  }

  const zohoEmails = {};
  const zohoByName = {};
  employees.forEach(employee => {
    const email = (employee.email || "").toString().trim().toLowerCase();
    if (email) zohoEmails[email] = true;
    const name = normalizeAuditName_(`${employee.first_name || ""} ${employee.last_name || ""}`);
    if (name) zohoByName[name] = (employee.email || "").toString().trim();
  });

  const directory = fetchSlackDirectory_();
  if (!directory.ok) {
    // Unlike the offboarding sweep there is no second signal to fall back on, so
    // a partial directory would quietly report a short list as if it were whole.
    throw new Error("Could not read the Slack member list — see the log for the users.list error");
  }

  const logIndex = buildAuditLogIndex_();
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  let guests = 0;
  let deactivated = 0;
  let noEmail = 0;
  let members = 0;
  const current = {};

  Object.keys(directory.byId).forEach(id => {
    const member = directory.byId[id];
    if (member.deleted) { deactivated++; return; }
    if (!member.email) { noEmail++; return; }
    if (SLACK_AUDIT_MEMBERS_ONLY && (member.restricted || member.ultraRestricted)) {
      guests++;
      return;
    }
    members++;
    if (zohoEmails[member.email]) return;

    const logRow = logIndex.byEmail[member.email] || logIndex.bySlackId[id] || null;
    const nameKey = normalizeAuditName_(member.realName || member.displayName);
    current[id] = {
      id: id,
      name: member.realName || "",
      displayName: member.displayName || "",
      email: member.email,
      accountType: describeSlackAccountType_(member),
      inLog: logRow ? "yes" : "no",
      exempt: logRow ? logRow.exempt : "",
      // A Zoho record under a different email is the most common innocent
      // explanation, and the one a human can act on fastest.
      zohoMatch: (nameKey && zohoByName[nameKey]) ? zohoByName[nameKey] : ""
    };
  });

  const existing = readSlackAuditSheet_();
  const merged = mergeSlackAuditRows_(existing, byEmail_(current), directory, zohoEmails, today);
  const freshlyFound = merged.filter(row => row.status === SLACK_AUDIT_STATUS_NEW);

  Logger.log("=".repeat(78));
  Logger.log("Slack vs Zoho — active Slack members missing from the Zoho org tree");
  Logger.log(`Zoho org tree              : ${employees.length} active employee(s)`);
  Logger.log(`Slack accounts (non-bot)   : ${Object.keys(directory.byId).length}`);
  Logger.log(`  deactivated (skipped)    : ${deactivated}`);
  Logger.log(`  no email on profile      : ${noEmail}`);
  Logger.log(`  guests (skipped)         : ${guests}`);
  Logger.log(`  full members checked     : ${members}`);
  Logger.log(`Open — not in Zoho         : ${Object.keys(current).length}`);
  Logger.log(`  of which new today       : ${freshlyFound.length}`);
  Logger.log(`Rows carried on the tab    : ${merged.length}`);
  Logger.log("=".repeat(78));
  merged.forEach(row => {
    Logger.log(
      `  [${row.status}] ${row.name || "(no name)"} <${row.email}>  ${row.accountType}  ` +
      `in log: ${row.inLog}` +
      (row.zohoMatch ? `  possible Zoho match: ${row.zohoMatch}` : "") +
      (row.prompt ? `  prompt: ${row.prompt}` : "")
    );
  });

  if (dryRun) {
    Logger.log(`Dry run — the "${SLACK_AUDIT_SHEET_NAME}" tab was not written and nothing was alerted.`);
    return { success: true, dryRun: true, open: Object.keys(current).length, isNew: freshlyFound.length };
  }

  writeSlackAuditSheet_(merged);
  Logger.log(`Wrote ${merged.length} row(s) to the "${SLACK_AUDIT_SHEET_NAME}" tab.`);

  if (freshlyFound.length) alertNewSlackAuditRows_(freshlyFound);

  return {
    success: true,
    dryRun: false,
    open: Object.keys(current).length,
    isNew: freshlyFound.length,
    rows: merged.length,
    members: members,
    guests: guests,
    deactivated: deactivated,
    noEmail: noEmail,
    zohoEmployees: employees.length
  };
}

/** Re-keys this run's findings from Slack user id to email, the tab's key. */
function byEmail_(current) {
  const keyed = {};
  Object.keys(current).forEach(id => { keyed[current[id].email] = current[id]; });
  return keyed;
}

/** Logs the reconciliation without writing the tab or alerting. */
function previewSlackAccountsNotInZoho() {
  return auditSlackAccountsNotInZoho({ dryRun: true });
}

/**
 * For the employee sync to call at the end of its run: logs and alerts on its
 * own failure, never throws into the caller. The sync's own job — adding and
 * updating employee rows — must not fail because a reconciliation report did.
 */
function auditSlackAccountsNotInZohoBestEffort_(options) {
  try {
    return auditSlackAccountsNotInZoho(options);
  } catch (error) {
    Logger.log(`Slack vs Zoho audit skipped: ${error.message}`);
    sendErrorAlert(
      `Slack vs Zoho audit failed — new Slack accounts missing from Zoho will not be reported: ${error.message}`,
      { functionName: "auditSlackAccountsNotInZohoBestEffort_", sheetName: SLACK_AUDIT_SHEET_NAME }
    );
    return { success: false, open: 0, isNew: 0, message: error.message };
  }
}

/**
 * Merges this run's findings over whatever the tab already holds.
 *
 * Three cases, and the third is the one worth being careful about:
 *   still missing from Zoho   → refresh the machine columns, keep the answer
 *   seen for the first time   → new row, status New, First Seen = today
 *   no longer reported        → kept with a Resolved status, NOT deleted
 *
 * Resolved rows stay because the tab carries a human decision. Deleting the row
 * would delete the answer, and the same account reappearing next week would come
 * back as "New" with the question asked all over again.
 */
function mergeSlackAuditRows_(existing, current, directory, zohoEmails, today) {
  const merged = [];
  const seen = {};

  Object.keys(current).forEach(email => {
    const found = current[email];
    const prior = existing[email] || null;
    seen[email] = true;
    merged.push({
      id: found.id,
      name: found.name,
      displayName: found.displayName,
      email: found.email,
      accountType: found.accountType,
      inLog: found.inLog,
      exempt: found.exempt,
      zohoMatch: found.zohoMatch,
      prompt: prior ? prior.prompt : "",
      notes: prior ? prior.notes : "",
      status: prior ? SLACK_AUDIT_STATUS_OPEN : SLACK_AUDIT_STATUS_NEW,
      firstSeen: (prior && prior.firstSeen) ? prior.firstSeen : today,
      lastChecked: today
    });
  });

  Object.keys(existing).forEach(email => {
    if (seen[email]) return;
    const prior = existing[email];
    merged.push({
      id: prior.id,
      name: prior.name,
      displayName: prior.displayName,
      email: prior.email,
      accountType: prior.accountType,
      inLog: prior.inLog,
      exempt: prior.exempt,
      zohoMatch: prior.zohoMatch,
      prompt: prior.prompt,
      notes: prior.notes,
      status: describeResolvedStatus_(prior, directory, zohoEmails),
      firstSeen: prior.firstSeen,
      lastChecked: today
    });
  });

  // New first — that is the part somebody has to act on — then still-open, then
  // everything already settled. Alphabetical inside each block.
  const rank = status => (status === SLACK_AUDIT_STATUS_NEW ? 0 : (status === SLACK_AUDIT_STATUS_OPEN ? 1 : 2));
  merged.sort((a, b) => {
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return (a.name || a.email).toLowerCase() < (b.name || b.email).toLowerCase() ? -1 : 1;
  });
  return merged;
}

/**
 * Why a row stopped being reported. "Resolved" on its own would leave a reader
 * guessing whether the person was added to Zoho or just lost their Slack
 * account, and those call for opposite follow-ups.
 */
function describeResolvedStatus_(prior, directory, zohoEmails) {
  const member = directory.byEmail[prior.email];
  if (!member) return "Resolved — not in the Slack directory";
  if (member.deleted) return "Resolved — Slack deactivated";
  if (member.restricted || member.ultraRestricted) return "Resolved — now a guest account";
  if (member.email && zohoEmails[member.email]) return "Resolved — now in Zoho";
  return "Resolved";
}

/**
 * "Member" / "Guest" / "Single-channel guest", with the workspace role appended
 * when there is one. Guests are filtered out by SLACK_AUDIT_MEMBERS_ONLY, but
 * the label still has to describe one: a row already on the tab can become a
 * guest account later, and that is why it stopped being reported.
 */
function describeSlackAccountType_(member) {
  const base = member.ultraRestricted
    ? "Single-channel guest"
    : (member.restricted ? "Guest" : "Member");
  if (member.owner) return `${base} · Owner`;
  if (member.admin) return `${base} · Admin`;
  return base;
}

/** Lower-cased, punctuation- and space-free, so "V Kartik" == "v. kartik". */
function normalizeAuditName_(text) {
  return (text || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The MissionHQ Log keyed by email and by Slack id, so the report can say
 * whether a flagged account is already tracked and already exempt.
 */
function buildAuditLogIndex_() {
  const index = { byEmail: {}, bySlackId: {} };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) return index;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return index;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const emailCol = headers.indexOf("Email Address");
  const slackIdCol = headers.indexOf(SLACK_USER_ID_COLUMN);
  const exemptCol = headers.indexOf(WFO_EXEMPT_COLUMN);
  if (emailCol === -1) return index;

  const grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  grid.forEach(row => {
    const entry = {
      email: (row[emailCol] || "").toString().trim().toLowerCase(),
      exempt: exemptCol !== -1 ? (row[exemptCol] || "").toString().trim() : ""
    };
    if (entry.email) index.byEmail[entry.email] = entry;
    const slackId = slackIdCol !== -1 ? (row[slackIdCol] || "").toString().trim() : "";
    if (slackId) index.bySlackId[slackId] = entry;
  });
  return index;
}

/**
 * The tab as it stands, keyed by Slack user id. Every column is read by HEADER
 * NAME rather than by position, so a column inserted by hand cannot shift the
 * manual answers into a machine column on the next run.
 */
function readSlackAuditSheet_() {
  const rows = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SLACK_AUDIT_SHEET_NAME);
  if (!sheet) return rows;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return rows;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const keyCol = headers.indexOf(SLACK_AUDIT_KEY_HEADER);
  if (keyCol === -1) {
    Logger.log(
      `"${SLACK_AUDIT_SHEET_NAME}" has no "${SLACK_AUDIT_KEY_HEADER}" column — treating every ` +
      `account as new and rebuilding the tab.`
    );
    return rows;
  }

  const at = header => headers.indexOf(header);
  const read = (row, header) => {
    const index = at(header);
    return index === -1 ? "" : (row[index] || "").toString().trim();
  };

  const grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  grid.forEach(row => {
    const email = (row[keyCol] || "").toString().trim().toLowerCase();
    if (!email) return;
    rows[email] = {
      id: "",
      email: email,
      name: read(row, "Slack Name"),
      displayName: "",
      accountType: "",
      inLog: read(row, "In MissionHQ Log"),
      exempt: read(row, "WFO Exempt"),
      zohoMatch: read(row, "Possible Zoho Match (by name)"),
      prompt: read(row, SLACK_AUDIT_PROMPT_HEADER),
      notes: read(row, SLACK_AUDIT_NOTES_HEADER),
      firstSeen: read(row, "First Seen")
    };
  });
  return rows;
}

/**
 * Rewrites the tab from the merged rows — which already carry the preserved
 * manual answers, so this is a rewrite of the data, not a discard of it.
 */
function writeSlackAuditSheet_(rows) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SLACK_AUDIT_SHEET_NAME);
  let created = false;
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SLACK_AUDIT_SHEET_NAME);
    created = true;
    Logger.log(`Created the "${SLACK_AUDIT_SHEET_NAME}" tab.`);
  }

  // Values only — never sheet.clear(), and no data validation of our own.
  // Range.clear() takes the data-validation rules with it, and the yes/no
  // dropdown on the decision column is the sheet owner's, not this script's.
  // Writing a competing rule also flags every hand-typed "Yes" as invalid,
  // which is what the red corner markers on that column were.
  const width = SLACK_AUDIT_HEADERS.length;
  const header = sheet.getRange(1, 1, 1, width);
  header.setValues([SLACK_AUDIT_HEADERS]);
  header.setFontWeight("bold");

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows.map(row => [
      row.name,
      row.email,
      row.inLog,
      row.exempt,
      row.zohoMatch,
      row.prompt,
      row.notes,
      row.status,
      row.firstSeen,
      row.lastChecked
    ]));
  }

  // The list shrinks when accounts resolve, so stale rows underneath have to
  // go — but by CONTENT only, within our own columns. A column somebody added
  // to the right of ours, and the formatting and validation on this one, are
  // none of this script's business.
  const lastRow = sheet.getLastRow();
  const firstStale = rows.length + 2;
  if (lastRow >= firstStale) {
    sheet.getRange(firstStale, 1, lastRow - firstStale + 1, width).clearContent();
  }

  sheet.setFrozenRows(1);
  if (created) sheet.autoResizeColumns(1, width);

  sheet.getRange(1, 1).setNote(
    `Refreshed by auditSlackAccountsNotInZoho(), at the end of every employee sync.\n\n` +
    `Every row is an active full Slack MEMBER whose email is not in the Zoho org tree.\n` +
    `Bots, deactivated accounts and guests are excluded.\n\n` +
    `"${SLACK_AUDIT_PROMPT_HEADER}" and "${SLACK_AUDIT_NOTES_HEADER}" are yours — they are\n` +
    `preserved on every run, matched by ${SLACK_AUDIT_KEY_HEADER}. Every other column is\n` +
    `overwritten. Rows that stop being reported are kept with a Resolved status\n` +
    `rather than deleted, so your answer is never thrown away.\n\n` +
    `Last run: ${Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss")} IST.`
  );
  SpreadsheetApp.flush();
}

/**
 * One message naming everybody new, not one per person — a day that turns up
 * five accounts is one story, and sendSuccessAlert does not dedupe.
 *
 * Only NEW rows alert. Reposting the still-open list every day is how a daily
 * alert becomes one nobody reads, and the tab is where the standing list lives.
 */
function alertNewSlackAuditRows_(rows) {
  const lines = rows.map(row => {
    const bits = [`*${row.name || row.email}* — ${row.email}`, row.accountType];
    if (row.inLog === "yes") bits.push(`in MissionHQ Log${row.exempt ? ` (${WFO_EXEMPT_COLUMN}: ${row.exempt})` : ""}`);
    else bits.push("not in the MissionHQ Log");
    if (row.zohoMatch) bits.push(`possible Zoho match: ${row.zohoMatch}`);
    return `• ${bits.join(" · ")}`;
  });

  sendSuccessAlert(
    `${rows.length} new Slack account(s) with no Zoho org-tree record`,
    {
      functionName: "auditSlackAccountsNotInZoho",
      additionalInfo:
        `${lines.join("\n")}\n\n` +
        `Listed on the *${SLACK_AUDIT_SHEET_NAME}* tab. Set *${SLACK_AUDIT_PROMPT_HEADER}* ` +
        `to \`yes\` for anyone who should still get the daily attendance prompt.\n` +
        `A "possible Zoho match" usually means the same person under a different ` +
        `email, not a leaver — check before treating them as one.`
    }
  );
}

// ---------------------------------------------------------------------------
// Acting on the decision: "Send Attendance Prompt? = yes" -> a MissionHQ Log row
//
// The tab is where a human answers "should this person still be checked in?".
// Nothing read that answer until this, so a `yes` sat there doing nothing.
//
// The answer is applied by routing people into the MissionHQ Log rather than by
// teaching the prompt flow a second source of truth. A person who should be
// prompted needs a Log row anyway: the daily flow, the reminder flow, the
// recovery sweep and every fortnightly summary all read that one sheet. Prompt
// them from somewhere else and they would get the DM and still be invisible in
// every report — a worse state than not being prompted at all.
//
// Two shapes of `yes`, and they need opposite repairs:
//
//   not in the Log      -> append a row. The daily flow fills the Slack id from
//                          the email on its first pass.
//   in the Log, exempt  -> clear the WFO Exempt cell. This is the email-mismatch
//                          case (Anuja Nair, Gayathri Meka, Harshit Shrivastava):
//                          employed, but under a second address, so the
//                          offboarding sweep read them as leavers and silenced
//                          them. They do not need a row, they need un-silencing.
// ---------------------------------------------------------------------------

/** Tab answers as { email: "yes" | "no" }, lower-cased on both sides. */
function readAttendancePromptDecisions_() {
  const decisions = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SLACK_AUDIT_SHEET_NAME);
  if (!sheet) return decisions;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return decisions;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const emailCol = headers.indexOf(SLACK_AUDIT_KEY_HEADER);
  const promptCol = headers.indexOf(SLACK_AUDIT_PROMPT_HEADER);
  if (emailCol === -1 || promptCol === -1) return decisions;

  const grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  grid.forEach(row => {
    const email = (row[emailCol] || "").toString().trim().toLowerCase();
    if (!email) return;
    // Lower-cased because the dropdown on that column is the sheet owner's and
    // offers "Yes"/"No"; matching on the exact string would silently ignore
    // every answer the moment somebody re-cased the list.
    const answer = (row[promptCol] || "").toString().trim().toLowerCase();
    if (answer) decisions[email] = answer;
  });
  return decisions;
}

/** The emails answered `yes`, as a lookup. Used by the offboarding sweep too. */
function attendancePromptAllowlist_() {
  const allowed = {};
  try {
    const decisions = readAttendancePromptDecisions_();
    Object.keys(decisions).forEach(email => {
      if (decisions[email] === "yes") allowed[email] = true;
    });
  } catch (error) {
    // A missing or malformed tab must never stop the daily prompt or the sweep.
    Logger.log(`Could not read "${SLACK_AUDIT_SHEET_NAME}" decisions: ${error.message}`);
  }
  return allowed;
}

/**
 * Moves everyone answered `yes` into the MissionHQ Log, and un-exempts the ones
 * already there. Idempotent: a second run finds nothing to do.
 *
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] log what would change, write nothing.
 */
function applyAttendancePromptDecisions(options) {
  options = options || {};
  const dryRun = options.dryRun === true;

  const decisions = readAttendancePromptDecisions_();
  const wanted = Object.keys(decisions).filter(email => decisions[email] === "yes");
  if (!wanted.length) {
    Logger.log(`No "${SLACK_AUDIT_PROMPT_HEADER} = yes" rows on the "${SLACK_AUDIT_SHEET_NAME}" tab.`);
    return { success: true, added: 0, unexempted: 0, alreadyActive: 0 };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const lastRow = sheet.getLastRow();
  const rowWidth = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, rowWidth).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  const nameColIndex = headers.indexOf("Full Name");
  if (emailColIndex === -1 || nameColIndex === -1) {
    throw new Error("Required columns (Full Name, Email Address) not found");
  }
  const slackIdColIndex = headers.indexOf(SLACK_USER_ID_COLUMN);
  const exemptCol = getOrCreateColumnIndex_(sheet, WFO_EXEMPT_COLUMN);

  const grid = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, rowWidth).getDisplayValues()
    : [];
  const exemptValues = lastRow > 1
    ? sheet.getRange(2, exemptCol.index + 1, lastRow - 1, 1).getDisplayValues()
    : [];

  const rowByEmail = {};
  grid.forEach((row, index) => {
    const email = (row[emailColIndex] || "").toString().trim().toLowerCase();
    if (email && rowByEmail[email] === undefined) rowByEmail[email] = index;
  });

  // Names come off the audit tab, which took them from the Slack profile — the
  // only name we have for somebody Zoho has never heard of.
  const namesByEmail = {};
  const auditRows = readSlackAuditSheet_();
  Object.keys(auditRows).forEach(email => { namesByEmail[email] = auditRows[email].name; });

  const added = [];
  const unexempted = [];
  let alreadyActive = 0;

  wanted.forEach(email => {
    const index = rowByEmail[email];

    if (index === undefined) {
      const row = new Array(rowWidth).fill("");
      row[nameColIndex] = namesByEmail[email] || email;
      row[emailColIndex] = email;
      // The Slack id is left blank on purpose: the daily flow resolves it from
      // the email on its first pass and writes it back, which is the same path
      // every other new row takes. One fewer API call here, one fewer way for
      // this to fail before the prompt even goes out.
      if (slackIdColIndex !== -1) row[slackIdColIndex] = "";
      added.push({ email: email, name: row[nameColIndex], row: row });
      return;
    }

    if (isWfoExempt_(exemptValues[index][0])) {
      unexempted.push({
        email: email,
        name: (grid[index][nameColIndex] || "").toString().trim() || email,
        was: (exemptValues[index][0] || "").toString().trim(),
        index: index
      });
      return;
    }

    alreadyActive++;
  });

  if (!added.length && !unexempted.length) {
    Logger.log(
      `Attendance prompt decisions: nothing to do — all ${wanted.length} "yes" row(s) ` +
      `are already live in ${CANDIDATE_SHEET_NAME}.`
    );
    return { success: true, added: 0, unexempted: 0, alreadyActive: alreadyActive };
  }

  added.forEach(entry => Logger.log(`${dryRun ? "[dry run] would add" : "Adding"} to ${CANDIDATE_SHEET_NAME}: ${entry.name} <${entry.email}>`));
  unexempted.forEach(entry => Logger.log(`${dryRun ? "[dry run] would clear" : "Clearing"} ${WFO_EXEMPT_COLUMN} for ${entry.name} <${entry.email}> (was "${entry.was}")`));

  if (dryRun) {
    return {
      success: true, dryRun: true, added: 0, unexempted: 0,
      wouldAdd: added.length, wouldUnexempt: unexempted.length, alreadyActive: alreadyActive
    };
  }

  if (unexempted.length) {
    unexempted.forEach(entry => { exemptValues[entry.index][0] = ""; });
    sheet.getRange(2, exemptCol.index + 1, exemptValues.length, 1).setValues(exemptValues);
  }
  if (added.length) {
    sheet.getRange(lastRow + 1, 1, added.length, rowWidth).setValues(added.map(entry => entry.row));
  }
  SpreadsheetApp.flush();

  // Alerted because it puts people INTO a daily DM and into a published
  // ranking. A wrong `yes` has to be visible enough to take back, the same way
  // the offboarding sweep announces every row it silences.
  sendSuccessAlert(
    `${added.length + unexempted.length} person/people added to the daily attendance check-in`,
    {
      functionName: "applyAttendancePromptDecisions",
      additionalInfo:
        added.concat([]).map(entry => `• *${entry.name}* — ${entry.email} · new ${CANDIDATE_SHEET_NAME} row`)
          .concat(unexempted.map(entry => `• *${entry.name}* — ${entry.email} · ${WFO_EXEMPT_COLUMN} cleared (was "${entry.was}")`))
          .join("\n") +
        `\n\nFrom *${SLACK_AUDIT_PROMPT_HEADER} = yes* on the *${SLACK_AUDIT_SHEET_NAME}* tab. ` +
        `Set it back to \`no\` to undo — a new row still needs deleting by hand.`
    }
  );

  const message =
    `Attendance prompt decisions: added ${added.length} row(s), cleared ${WFO_EXEMPT_COLUMN} on ` +
    `${unexempted.length}, ${alreadyActive} already live.`;
  Logger.log(message);
  return {
    success: true, dryRun: false,
    added: added.length, unexempted: unexempted.length, alreadyActive: alreadyActive,
    names: added.map(entry => entry.name).concat(unexempted.map(entry => entry.name)),
    message: message
  };
}

/** Dry run: logs who would be added or un-exempted, writes nothing. */
function previewAttendancePromptDecisions() {
  return applyAttendancePromptDecisions({ dryRun: true });
}

/**
 * What the daily prompt flow calls. Never throws into it: a problem reading one
 * decision tab must not stop the whole org being checked in.
 */
function applyAttendancePromptDecisionsBestEffort_() {
  try {
    return applyAttendancePromptDecisions();
  } catch (error) {
    Logger.log(`Attendance prompt decisions skipped: ${error.message}`);
    sendErrorAlert(
      `Could not apply "${SLACK_AUDIT_PROMPT_HEADER}" decisions — anyone newly marked yes will ` +
      `not be prompted today: ${error.message}`,
      { functionName: "applyAttendancePromptDecisionsBestEffort_", sheetName: SLACK_AUDIT_SHEET_NAME }
    );
    return { success: false, added: 0, unexempted: 0, message: error.message };
  }
}
