/**
 * POFU (Post-Offer Follow-Up) sheet sync.
 *
 * Mirrors the employees already fetched by syncEmployeesFromZohoOrgTree() into
 * the separate POFU HyperVerge spreadsheet, so the onboarding check-in
 * automation (48 hour / 30 day / 90 day messages) has a single machine-written
 * roster to drive off.
 *
 * This module NEVER calls Zoho. It takes the employees array the org-tree fetch
 * already returned and writes it out — one Zoho request per sync, not two.
 * The message-status columns belong to the POFU automation script; this sync
 * creates them and then leaves their values alone forever.
 */

const POFU_SPREADSHEET_ID = "1WwOGtlmsunuEehrKvZZ576TU7goSmeTOb0OyVbQp6zk";
const POFU_SHEET_NAME = "POFU Automation";

/**
 * Columns written to the POFU sheet, in creation order.
 *
 * `candidates` lets an existing hand-made column be reused instead of a
 * near-duplicate being appended next to it (matched case/punctuation-insensitively,
 * same rule as findColumnIndexByCandidates_). `owned: false` marks the three
 * trigger columns — created if missing, never written by this sync.
 */
const POFU_COLUMN_SPECS = [
  { key: "name",   header: "Employee Name",   owned: true,  candidates: ["Employee Name", "Full Name", "Name"] },
  { key: "empId",  header: "Employee ID",     owned: true,  candidates: ["Employee ID", "Emp ID", "Zoho Emp ID", "Employee Id"] },
  { key: "email",  header: "Employee Email",  owned: true,  candidates: ["Employee Email", "Email Address", "Email ID", "Email"] },
  { key: "doj",    header: "Date of Joining", owned: true,  candidates: ["Date of Joining", "Joining Date", "DOJ", "Date Joined"] },
  { key: "msg48h", header: "48 Hour Message", owned: false, candidates: ["48 Hour Message", "48 Hr Message", "48hr Message"] },
  { key: "msg30d", header: "30 Day Message",  owned: false, candidates: ["30 Day Message", "30 Days Message", "30day Message"] },
  { key: "msg90d", header: "90 Day Message",  owned: false, candidates: ["90 Day Message", "90 Days Message", "90day Message"] }
];

/**
 * Visual theme for the POFU tab. Kept in one place so the whole sheet can be
 * re-skinned without hunting through formatPofuSheet_().
 */
const POFU_THEME = {
  headerBg: "#243B53",
  headerText: "#FFFFFF",
  border: "#D8DEE7"
};

const POFU_COLUMN_WIDTHS = { name: 190, empId: 110, email: 260, doj: 130, msg48h: 150, msg30d: 150, msg90d: 150 };
const POFU_COLUMN_ALIGNMENTS = { name: "left", empId: "center", email: "left", doj: "center", msg48h: "center", msg30d: "center", msg90d: "center" };

/**
 * Parses the org-tree `date_of_joining` ("10-Aug-2026") into a real Date, so
 * the column sorts chronologically and the automation can do day arithmetic on
 * it without re-parsing strings. Unparseable values are passed through as text
 * rather than dropped — a date we cannot read still beats a blank cell.
 * @return {Date|string} a Date, the raw string, or "" when there is no value.
 */
function parsePofuDate_(value) {
  if (value === null || value === undefined) return "";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? "" : value;
  }

  const raw = value.toString().trim();
  if (!raw) return "";

  // Build the Date from parts so it lands at local midnight — new Date("2026-08-10")
  // is parsed as UTC and slips to the previous day in negative-offset zones.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  return raw;
}


/**
 * Finds the POFU sheet (creating it if absent) and resolves every column in
 * POFU_COLUMN_SPECS to a 0-based index, appending any header that is missing.
 * @return {{sheet: Sheet, columns: Object, headersAdded: Array<string>, sheetCreated: boolean}}
 */
function getOrCreatePofuSheet_() {
  const spreadsheet = SpreadsheetApp.openById(POFU_SPREADSHEET_ID);

  let sheet = spreadsheet.getSheetByName(POFU_SHEET_NAME);
  const sheetCreated = !sheet;
  if (sheetCreated) {
    sheet = spreadsheet.insertSheet(POFU_SHEET_NAME);
    sheet.setFrozenRows(1);
  }

  // getLastColumn() is 0 on a freshly inserted sheet, so guard the header read.
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(header => header.toString().trim())
    : [];

  const columns = {};
  const headersAdded = [];
  POFU_COLUMN_SPECS.forEach(spec => {
    const existing = findColumnIndexByCandidates_(headers, spec.candidates);
    if (existing !== -1) {
      columns[spec.key] = existing;
      return;
    }
    // Missing header: append it at the end. Existing columns keep their
    // position, so a hand-arranged sheet is never reshuffled.
    columns[spec.key] = headers.length;
    headers.push(spec.header);
    headersAdded.push(spec.header);
  });

  if (headersAdded.length > 0) {
    // The grid may be narrower than the header row we are about to write —
    // a freshly inserted sheet, or one trimmed to its data by formatPofuSheet_().
    const maxColumns = sheet.getMaxColumns();
    if (headers.length > maxColumns) sheet.insertColumnsAfter(maxColumns, headers.length - maxColumns);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    SpreadsheetApp.flush();
  }

  return { sheet: sheet, columns: columns, headersAdded: headersAdded, sheetCreated: sheetCreated };
}

/**
 * Restyles the whole tab. Runs at the end of every sync, so the formatting
 * always covers the rows that exist rather than drifting as people are added.
 *
 * Everything here is idempotent — banding is replaced rather than stacked, so a
 * year of daily runs leaves exactly one of it.
 *
 * Layout only: no conditional formatting and no per-cell colouring. The sheet's
 * own conditional rules, if any, belong to whoever set them and are left alone.
 * The only cell *values* touched are the joining dates, normalized to real
 * Dates; the three message columns' contents are never read or written.
 */
function formatPofuSheet_(sheet, columns) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const numRows = Math.max(lastRow - 1, 0);

  // --- Header -------------------------------------------------------------
  const header = sheet.getRange(1, 1, 1, lastColumn);
  header
    .setBackground(POFU_THEME.headerBg)
    .setFontColor(POFU_THEME.headerText)
    .setFontWeight("bold")
    .setFontSize(10)
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("left")
    .setWrap(false);
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);

  // --- Column widths and alignment ---------------------------------------
  Object.keys(POFU_COLUMN_WIDTHS).forEach(key => {
    if (columns[key] !== undefined) sheet.setColumnWidth(columns[key] + 1, POFU_COLUMN_WIDTHS[key]);
  });

  if (numRows > 0) {
    const data = sheet.getRange(2, 1, numRows, lastColumn);
    data.setVerticalAlignment("middle").setFontSize(10).setWrap(false);

    Object.keys(POFU_COLUMN_ALIGNMENTS).forEach(key => {
      if (columns[key] === undefined) return;
      sheet.getRange(2, columns[key] + 1, numRows, 1)
        .setHorizontalAlignment(POFU_COLUMN_ALIGNMENTS[key]);
    });

    // Employee ids are a mix of "551" and "INT390"; forcing plain text stops
    // Sheets right-aligning half of them and left-aligning the rest.
    if (columns.empId !== undefined) {
      sheet.getRange(2, columns.empId + 1, numRows, 1).setNumberFormat("@");
    }

    // --- Joining date: real Dates, one format ----------------------------
    if (columns.doj !== undefined) {
      const dojRange = sheet.getRange(2, columns.doj + 1, numRows, 1);
      const values = dojRange.getValues();
      let converted = 0;
      const normalized = values.map(row => {
        const value = row[0];
        if (value === "" || value === null || value === undefined) return [""];
        if (Object.prototype.toString.call(value) === "[object Date]") return [value];
        const parsed = parsePofuDate_(value);
        if (Object.prototype.toString.call(parsed) === "[object Date]") {
          converted++;
          return [parsed];
        }
        return [value];
      });
      if (converted > 0) dojRange.setValues(normalized);
      dojRange.setNumberFormat("yyyy-mm-dd");
    }

    // --- Newest joiners first --------------------------------------------
    // Sorts the full row width so any column a human added travels with its row.
    if (columns.doj !== undefined) {
      sheet.getRange(2, 1, numRows, lastColumn).sort({ column: columns.doj + 1, ascending: false });
    }

    // --- Banding ----------------------------------------------------------
    sheet.getBandings().forEach(banding => banding.remove());
    sheet.getRange(2, 1, numRows, lastColumn)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

    sheet.getRange(1, 1, lastRow, lastColumn)
      .setBorder(true, true, true, true, true, true, POFU_THEME.border, SpreadsheetApp.BorderStyle.SOLID);
  }

  // Conditional formatting is deliberately not managed here — the sheet's own
  // rules, if any, belong to whoever set them.

  // --- Filter, tab colour, trailing empties -------------------------------
  if (numRows > 0) {
    // Left alone once created — recreating it daily would wipe whatever filter
    // someone currently has applied. Only rebuilt when new rows or columns have
    // grown past the range it covers.
    const filter = sheet.getFilter();
    if (!filter) {
      sheet.getRange(1, 1, lastRow, lastColumn).createFilter();
    } else {
      const covered = filter.getRange();
      if (covered.getLastRow() < lastRow || covered.getLastColumn() < lastColumn) {
        filter.remove();
        sheet.getRange(1, 1, lastRow, lastColumn).createFilter();
      }
    }
  }
  sheet.setTabColor(POFU_THEME.headerBg);

  // Trim the empty expanse to the right and below, keeping a small pad so
  // there is somewhere to type.
  const maxColumns = sheet.getMaxColumns();
  if (maxColumns > lastColumn) sheet.deleteColumns(lastColumn + 1, maxColumns - lastColumn);
  const maxRows = sheet.getMaxRows();
  const keepRows = Math.max(lastRow + 10, 2);
  if (maxRows > keepRows) sheet.deleteRows(keepRows + 1, maxRows - keepRows);
}

/**
 * Writes the already-fetched org-tree employees into the POFU sheet.
 *
 * Matched by email (lower-cased). New emails are appended; existing rows have
 * Name and Date of Joining filled only when blank, and Employee ID kept in sync
 * with Zoho (it can change, e.g. a contractor "348C" converting to "348") —
 * the same rule the MissionHQ Log sync uses. The 48 hour / 30 day / 90 day
 * columns are created if missing and otherwise never touched, since the POFU
 * automation owns them.
 *
 * @param {Array<Object>} employees org-tree employees, already fetched.
 * @return {Object} counts for the caller's log.
 */
function syncEmployeesToPofuSheet(employees) {
  if (!employees || !employees.length) {
    Logger.log("POFU sync: no employees supplied — nothing to write.");
    return { added: 0, updated: 0, unchanged: 0, skipped: 0, joiningDatesFilled: 0, headersAdded: [], sheetCreated: false };
  }

  const { sheet, columns, headersAdded, sheetCreated } = getOrCreatePofuSheet_();
  if (sheetCreated) Logger.log(`POFU sync: created sheet "${POFU_SHEET_NAME}".`);
  if (headersAdded.length) Logger.log(`POFU sync: added missing header(s): ${headersAdded.join(", ")}.`);

  const rowWidth = Math.max.apply(null, Object.keys(columns).map(key => columns[key])) + 1;
  const lastRow = sheet.getLastRow();

  // Existing rows, keyed by email. Only the columns this sync owns are read.
  const existingRowByEmail = {};
  let nameValues = [];
  let empIdValues = [];
  let dojValues = [];
  if (lastRow > 1) {
    const dataRowCount = lastRow - 1;
    const emailValues = sheet.getRange(2, columns.email + 1, dataRowCount, 1).getDisplayValues();
    nameValues = sheet.getRange(2, columns.name + 1, dataRowCount, 1).getValues();
    empIdValues = sheet.getRange(2, columns.empId + 1, dataRowCount, 1).getValues();
    dojValues = sheet.getRange(2, columns.doj + 1, dataRowCount, 1).getValues();
    emailValues.forEach((row, i) => {
      const email = row[0]?.toString().trim().toLowerCase();
      if (email && !(email in existingRowByEmail)) existingRowByEmail[email] = i;
    });
  }

  const newRows = [];
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let namesFilled = 0;
  let empIdsUpdated = 0;
  let joiningDatesFilled = 0;
  let missingJoiningDate = 0;

  employees.forEach(employee => {
    const email = (employee.email || "").toString().trim();
    const emailKey = email.toLowerCase();
    if (!emailKey) {
      skipped++;
      return;
    }

    const fullName = [employee.first_name, employee.last_name]
      .map(part => (part || "").toString().trim())
      .filter(Boolean)
      .join(" ");
    const empId = (employee.emp_id || "").toString().trim();
    const joiningDate = parsePofuDate_(employee.date_of_joining);
    if (!joiningDate) missingJoiningDate++;

    if (emailKey in existingRowByEmail) {
      const rowIndex = existingRowByEmail[emailKey];
      if (rowIndex === -1) return; // duplicate inside the payload itself
      let touched = false;

      if (!nameValues[rowIndex][0]?.toString().trim() && fullName) {
        nameValues[rowIndex][0] = fullName;
        namesFilled++;
        touched = true;
      }
      // Employee ID tracks Zoho — overwritten whenever it differs, not only when blank.
      if (empId && (empIdValues[rowIndex][0]?.toString().trim() || "") !== empId) {
        empIdValues[rowIndex][0] = empId;
        empIdsUpdated++;
        touched = true;
      }
      // Joining date is filled only when blank, so a corrected date entered by
      // hand is never overwritten by the org tree.
      if (!dojValues[rowIndex][0]?.toString().trim() && joiningDate) {
        dojValues[rowIndex][0] = joiningDate;
        joiningDatesFilled++;
        touched = true;
      }

      if (touched) updated++; else unchanged++;
      return;
    }
    existingRowByEmail[emailKey] = -1; // guard against duplicates within the payload

    const row = new Array(rowWidth).fill("");
    row[columns.name] = fullName;
    row[columns.empId] = empId;
    row[columns.email] = email;
    row[columns.doj] = joiningDate;
    // Message columns stay blank — the POFU automation fills them.
    newRows.push(row);
  });

  // One batched write per touched column, then one append for all new rows.
  if (namesFilled > 0) sheet.getRange(2, columns.name + 1, nameValues.length, 1).setValues(nameValues);
  if (empIdsUpdated > 0) sheet.getRange(2, columns.empId + 1, empIdValues.length, 1).setValues(empIdValues);
  if (joiningDatesFilled > 0) sheet.getRange(2, columns.doj + 1, dojValues.length, 1).setValues(dojValues);
  if (newRows.length > 0) {
    // formatPofuSheet_() trims the grid to the data plus a small pad, so make
    // sure there is room before appending.
    const neededRows = lastRow + newRows.length;
    const maxRows = sheet.getMaxRows();
    if (neededRows > maxRows) sheet.insertRowsAfter(maxRows, neededRows - maxRows);
    sheet.getRange(lastRow + 1, 1, newRows.length, rowWidth).setValues(newRows);
  }
  SpreadsheetApp.flush();

  // Restyle last, so the formatting covers the rows just appended. Best-effort:
  // the roster is the point, the paint job is not worth failing a sync over.
  try {
    formatPofuSheet_(sheet, columns);
  } catch (formatError) {
    Logger.log(`POFU sync: formatting skipped — ${formatError.message}`);
  }

  if (missingJoiningDate > 0) {
    // Not an error, but worth seeing: their 48h/30d/90d triggers cannot fire
    // until the date is filled, by Zoho or by hand.
    Logger.log(`POFU sync: ${missingJoiningDate} employee(s) have a blank date_of_joining in Zoho — Date of Joining left blank for them.`);
  }
  Logger.log(
    `POFU sync complete. Added ${newRows.length}; updated ${updated} existing row(s) ` +
    `(names ${namesFilled}, employee ids ${empIdsUpdated}, joining dates ${joiningDatesFilled}); ` +
    `unchanged ${unchanged}; skipped ${skipped} (no email).`
  );

  return {
    added: newRows.length,
    updated: updated,
    unchanged: unchanged,
    skipped: skipped,
    namesFilled: namesFilled,
    empIdsUpdated: empIdsUpdated,
    joiningDatesFilled: joiningDatesFilled,
    missingJoiningDate: missingJoiningDate,
    headersAdded: headersAdded,
    sheetCreated: sheetCreated
  };
}
