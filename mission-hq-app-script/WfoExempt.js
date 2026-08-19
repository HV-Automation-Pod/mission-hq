// ---------------------------------------------------------------------------
// WFO Exempt — taking someone out of attendance without deleting their history.
//
// Writes the Log's WFO_EXEMPT_COLUMN. A marked row gets no daily prompt, no
// reminder, and appears in no fortnightly summary or dashboard number. Nothing
// is removed from the sheet: their past check-ins stay exactly where they are.
//
// Use it for people who have left (their Slack account is deactivated, so the
// bot cannot reach them anyway) and for PnC-approved exceptions.
// ---------------------------------------------------------------------------

/** Menu entry: asks for emails and a reason, then marks them. */
function promptMarkWfoExempt() {
  const ui = SpreadsheetApp.getUi();

  const emailAnswer = ui.prompt(
    "Mark WFO Exempt",
    "Email address(es), comma separated:",
    ui.ButtonSet.OK_CANCEL
  );
  if (emailAnswer.getSelectedButton() !== ui.Button.OK) return;

  const emails = emailAnswer.getResponseText().split(",").map(email => email.trim()).filter(Boolean);
  if (emails.length === 0) {
    ui.alert("No email addresses entered.");
    return;
  }

  const reasonAnswer = ui.prompt(
    "Mark WFO Exempt",
    'Reason (stored in the cell, e.g. "Offboarded 2026-08-18"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (reasonAnswer.getSelectedButton() !== ui.Button.OK) return;

  const result = markWfoExempt(emails, reasonAnswer.getResponseText().trim());
  ui.alert(
    `Marked ${result.marked.length}: ${result.marked.join(", ") || "(none)"}` +
    (result.notFound.length > 0 ? `\n\nNot found in the Log: ${result.notFound.join(", ")}` : "")
  );
}

/**
 * Marks each email exempt. The column is created at the end of the sheet if it
 * does not exist yet. Returns { marked, notFound }.
 */
function markWfoExempt(emails, reason) {
  return setWfoExemptValue_(emails, (reason || "Yes").toString().trim() || "Yes");
}

/** Puts someone back into attendance — clears their exempt cell. */
function clearWfoExempt(emails) {
  return setWfoExemptValue_(emails, "");
}

function setWfoExemptValue_(emails, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const exemptColIndex = getOrCreateColumnIndex_(sheet, WFO_EXEMPT_COLUMN).index;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  if (emailColIndex === -1) throw new Error(`Column "Email Address" not found in ${CANDIDATE_SHEET_NAME}`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { marked: [], notFound: emails };

  const emailValues = sheet.getRange(2, emailColIndex + 1, lastRow - 1, 1).getDisplayValues();
  const wanted = {};
  emails.forEach(email => { wanted[email.toString().trim().toLowerCase()] = false; });

  const marked = [];
  emailValues.forEach((row, i) => {
    const email = row[0] ? row[0].toString().trim().toLowerCase() : "";
    if (!email || !(email in wanted)) return;
    sheet.getRange(i + 2, exemptColIndex + 1).setValue(value);
    wanted[email] = true;
    marked.push(email);
  });
  SpreadsheetApp.flush();

  const notFound = Object.keys(wanted).filter(email => !wanted[email]);
  Logger.log(
    `${WFO_EXEMPT_COLUMN} set to "${value}" for ${marked.length} row(s): ${marked.join(", ") || "(none)"}` +
    (notFound.length > 0 ? ` — not found: ${notFound.join(", ")}` : "")
  );
  return { marked: marked, notFound: notFound };
}
