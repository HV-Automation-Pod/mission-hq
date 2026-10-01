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
