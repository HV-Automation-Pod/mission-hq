// ---------------------------------------------------------------------------
// Slack vs Zoho reconciliation — who has a live Slack account that the HRIS
// does not know about.
//
// The offboarding sweep (Offboarding.js) answers a narrower question: of the
// people already IN the MissionHQ Log, who has left? It can only ever see rows
// the Log already has, so somebody who never made it into the Log — a Slack
// account created for a contractor, a vendor, an alias, a test user, or a hire
// Zoho records under a different email — is invisible to it.
//
// This is the other direction. It walks the whole Slack member list and reports
// every ACTIVE account whose email the Zoho org tree does not contain.
//
// Deliberately a report, not a sweep. The offboarding signal ("absent from Zoho"
// == no longer employed) is only safe against the Log, where every row was put
// there by the Zoho sync in the first place. Against the raw Slack directory the
// same rule would flag guests, vendors and anyone whose Zoho email differs from
// their Slack one — so this writes a tab for a human to triage and changes
// nothing else.
// ---------------------------------------------------------------------------

const SLACK_AUDIT_SHEET_NAME = "Slack vs Zoho";

const SLACK_AUDIT_HEADERS = [
  "Slack Name",
  "Display Name",
  "Email",
  "Domain",
  "Slack User ID",
  "Account Type",
  "In MissionHQ Log",
  "WFO Exempt",
  "Possible Zoho Match (by name)",
  "Checked On"
];

/**
 * Lists every active Slack account whose email is absent from the Zoho org
 * tree, and writes them to the "Slack vs Zoho" tab.
 *
 * @param {Object} [options]
 * @param {Array<Object>} [options.employees]  org-tree payload, when the caller
 *        already has one (the employee sync does). Omitted → fetched here.
 * @param {boolean} [options.dryRun]  log the list, write no tab.
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
    // Unlike the offboarding sweep, there is no second signal to fall back on —
    // a partial directory would silently report a short list as if complete.
    throw new Error("Could not read the Slack member list — see the log for the users.list error");
  }

  const logIndex = buildAuditLogIndex_();
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  let activeWithEmail = 0;
  let noEmail = 0;
  let deactivated = 0;
  const findings = [];

  Object.keys(directory.byId).forEach(id => {
    const member = directory.byId[id];
    if (member.deleted) { deactivated++; return; }
    if (!member.email) { noEmail++; return; }
    activeWithEmail++;
    if (zohoEmails[member.email]) return;

    const logRow = logIndex.byEmail[member.email] || logIndex.bySlackId[id] || null;
    const nameKey = normalizeAuditName_(member.realName || member.displayName);
    findings.push([
      member.realName || "",
      member.displayName || "",
      member.email,
      member.email.indexOf("@") !== -1 ? member.email.split("@")[1] : "",
      id,
      describeSlackAccountType_(member),
      logRow ? "yes" : "no",
      logRow ? logRow.exempt : "",
      // A Zoho record under a different email address is the most common
      // innocent explanation, and the one a human can act on fastest.
      (nameKey && zohoByName[nameKey]) ? zohoByName[nameKey] : "",
      today
    ]);
  });

  // Full members first, then guests, then single-channel guests, each block
  // alphabetical. A full member the HRIS has never heard of is the row worth
  // acting on; a vendor guest usually is not, so the top of the tab is the part
  // worth reading. Alphabetical order alone would bury members under "Guest".
  findings.sort((a, b) => {
    const rank = type => (type.indexOf("Single-channel") === 0 ? 2 : (type.indexOf("Guest") === 0 ? 1 : 0));
    if (rank(a[5]) !== rank(b[5])) return rank(a[5]) - rank(b[5]);
    return (a[0] || a[2]).toLowerCase() < (b[0] || b[2]).toLowerCase() ? -1 : 1;
  });

  Logger.log("=".repeat(78));
  Logger.log(`Slack vs Zoho — active Slack accounts missing from the Zoho org tree`);
  Logger.log(`Zoho org tree              : ${employees.length} active employee(s)`);
  Logger.log(`Slack members (non-bot)    : ${Object.keys(directory.byId).length}`);
  Logger.log(`  active with an email     : ${activeWithEmail}`);
  Logger.log(`  deactivated (skipped)    : ${deactivated}`);
  Logger.log(`  no email on profile      : ${noEmail}`);
  Logger.log(`NOT in Zoho                : ${findings.length}`);
  Logger.log("=".repeat(78));
  findings.forEach(row => {
    Logger.log(
      `  ${row[0] || "(no name)"} <${row[2]}>  ${row[5]}  ` +
      `in log: ${row[6]}` + (row[8] ? `  possible Zoho match: ${row[8]}` : "")
    );
  });

  if (dryRun) {
    Logger.log(`Dry run — the "${SLACK_AUDIT_SHEET_NAME}" tab was not written.`);
    return { success: true, dryRun: true, found: findings.length, checked: activeWithEmail };
  }

  writeSlackAuditSheet_(findings);
  Logger.log(`Wrote ${findings.length} row(s) to the "${SLACK_AUDIT_SHEET_NAME}" tab.`);

  return {
    success: true,
    dryRun: false,
    found: findings.length,
    checked: activeWithEmail,
    deactivated: deactivated,
    noEmail: noEmail,
    zohoEmployees: employees.length,
    rows: findings
  };
}

/** Logs the list without writing the tab. */
function previewSlackAccountsNotInZoho() {
  return auditSlackAccountsNotInZoho({ dryRun: true });
}

/**
 * "Member" / "Guest" / "Single-channel guest", with the workspace role appended
 * when there is one. Guests are the usual innocent reason for an account the
 * HRIS has never heard of, so the distinction belongs in the report rather than
 * in a filter that quietly drops them.
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
 * Clears and rewrites the tab. Created on first run; the header row is written
 * every time so the shape cannot drift.
 */
function writeSlackAuditSheet_(rows) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SLACK_AUDIT_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SLACK_AUDIT_SHEET_NAME);
    Logger.log(`Created the "${SLACK_AUDIT_SHEET_NAME}" tab.`);
  }

  sheet.clear();
  const header = sheet.getRange(1, 1, 1, SLACK_AUDIT_HEADERS.length);
  header.setValues([SLACK_AUDIT_HEADERS]);
  header.setFontWeight("bold");
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, SLACK_AUDIT_HEADERS.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, SLACK_AUDIT_HEADERS.length);

  sheet.getRange(1, 1).setNote(
    `Rebuilt by auditSlackAccountsNotInZoho(). Edits here are overwritten.\n` +
    `Every row is an ACTIVE Slack account whose email is not in the Zoho org tree.\n` +
    `Deactivated accounts and bots are excluded; guests are included and labelled.\n` +
    `Last run: ${Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss")} IST.`
  );
  SpreadsheetApp.flush();
}
