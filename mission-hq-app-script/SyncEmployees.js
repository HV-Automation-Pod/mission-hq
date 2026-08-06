const ZOHO_ORG_TREE_URL_PROPERTY = "ZOHO_ORG_TREE_URL";
const ZOHO_ORG_TREE_TOKEN_PROPERTY = "ZOHO_ORG_TREE_TOKEN";

/**
 * Fetches all active employees from the Zoho org-tree endpoint and syncs them
 * into the "MissionHQ Log" sheet:
 *   - Appends Full Name / Email / Slack User ID / Department / Location /
 *     Employee ID rows for employees whose email is not in the sheet yet.
 *   - For existing rows, fills Location and Slack User ID only when blank, and
 *     keeps Employee ID in sync with Zoho — overwriting it whenever it changed
 *     (e.g. a contractor id like "348C" converting to a full-time "348").
 *
 * Employee ID comes from the org-tree `emp_id` field and is the join key used to
 * match Zoho leave records (which carry an EmployeeId but no email) back to the
 * sheet. Idempotent: safe to run repeatedly without creating duplicates.
 */
function syncEmployeesFromZohoOrgTree() {
  try {
  const employees = fetchZohoOrgTreeEmployees_();
  if (!employees.length) {
    Logger.log("No employees returned from org-tree endpoint.");
    return { added: 0, skipped: 0, locationsFilled: 0, empIdsUpdated: 0, slackIdsFilled: 0 };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${CANDIDATE_SHEET_NAME}" not found`);
  }

  // Slack User ID and Employee ID columns are auto-created if missing. Look up
  // an existing employee-id column under any known header first, so we reuse it
  // instead of creating a duplicate.
  const slackIdColIndex = getOrCreateColumnIndex_(sheet, SLACK_USER_ID_COLUMN).index;
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString());
  let empIdColIndex = findColumnIndexByCandidates_(headers, ZOHO_ATTENDANCE_EMPID_COLUMNS);
  if (empIdColIndex === -1) empIdColIndex = getOrCreateColumnIndex_(sheet, EMPLOYEE_ID_COLUMN).index;

  headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString());
  const nameColIndex = headers.indexOf("Full Name");
  const emailColIndex = headers.indexOf("Email Address");
  const deptColIndex = headers.indexOf("Department");
  const locColIndex = headers.indexOf("Location");
  if (nameColIndex === -1 || emailColIndex === -1 || deptColIndex === -1 || locColIndex === -1) {
    throw new Error(
      'Required columns "Full Name", "Email Address", "Department" or "Location" not found in header row'
    );
  }

  // Map of email -> 0-based data row index for rows already in the sheet, plus
  // the current values of the columns we may fill.
  const existingRowByEmail = {};
  const lastRow = sheet.getLastRow();
  let locationValues = [];
  let empIdValues = [];
  let slackIdValues = [];
  let departmentValues = [];
  if (lastRow > 1) {
    const emailValues = sheet.getRange(2, emailColIndex + 1, lastRow - 1, 1).getValues();
    locationValues = sheet.getRange(2, locColIndex + 1, lastRow - 1, 1).getValues();
    empIdValues = sheet.getRange(2, empIdColIndex + 1, lastRow - 1, 1).getValues();
    slackIdValues = sheet.getRange(2, slackIdColIndex + 1, lastRow - 1, 1).getValues();
    departmentValues = sheet.getRange(2, deptColIndex + 1, lastRow - 1, 1).getValues();
    emailValues.forEach((row, i) => {
      const email = row[0]?.toString().trim().toLowerCase();
      if (email && !(email in existingRowByEmail)) existingRowByEmail[email] = i;
    });
  }

  // Width of the row block we write (up to the right-most of the target columns).
  const rowWidth = Math.max(nameColIndex, emailColIndex, slackIdColIndex, deptColIndex, locColIndex, empIdColIndex) + 1;

  const newRows = [];
  let skipped = 0;
  let locationsFilled = 0;
  let empIdsUpdated = 0;
  let departmentsUpdated = 0;
  let slackIdsFilled = 0;
  let slackIdsResolved = 0;
  employees.forEach(emp => {
    const email = (emp.email || "").toString().trim();
    const emailKey = email.toLowerCase();
    if (!emailKey) {
      skipped++;
      return;
    }
    const zohoLocation = (emp.location || "").toString().trim();
    const empId = (emp.emp_id || "").toString().trim();
    const zohoDepartment = (emp.department || "").toString().trim();

    if (emailKey in existingRowByEmail) {
      // Existing row: Location / Slack ID are filled only when blank; Employee ID
      // and Department track Zoho and are overwritten whenever they differ.
      const rowIndex = existingRowByEmail[emailKey];
      let touched = false;
      if (!locationValues[rowIndex][0]?.toString().trim() && zohoLocation) {
        locationValues[rowIndex][0] = zohoLocation;
        locationsFilled++;
        touched = true;
      }
      // Employee ID tracks Zoho (it can change, e.g. contractor -> full-time),
      // so update it whenever it differs — not only when blank.
      if (empId && (empIdValues[rowIndex][0]?.toString().trim() || "") !== empId) {
        empIdValues[rowIndex][0] = empId;
        empIdsUpdated++;
        touched = true;
      }
      // Department also tracks Zoho — overwrite when it differs (people move teams).
      // Only when Zoho has a non-blank value, so a missing API value never clears it.
      if (zohoDepartment && (departmentValues[rowIndex][0]?.toString().trim() || "") !== zohoDepartment) {
        departmentValues[rowIndex][0] = zohoDepartment;
        departmentsUpdated++;
        touched = true;
      }
      if (!slackIdValues[rowIndex][0]?.toString().trim()) {
        const info = getUserInfoByEmail(email);
        if (info && info.id) {
          slackIdValues[rowIndex][0] = info.id;
          slackIdsFilled++;
          touched = true;
        }
      }
      if (!touched) skipped++;
      return;
    }
    existingRowByEmail[emailKey] = -1; // guard against duplicates within the payload itself

    const fullName = [emp.first_name, emp.last_name]
      .map(part => (part || "").toString().trim())
      .filter(Boolean)
      .join(" ");
    const department = (emp.department || "").toString().trim();

    // Resolve the Slack id once for the new hire (best-effort: if they are not
    // in Slack yet, leave it blank and the daily flow will fill it later).
    let slackId = "";
    const userInfo = getUserInfoByEmail(email);
    if (userInfo && userInfo.id) {
      slackId = userInfo.id;
      slackIdsResolved++;
    }

    const row = new Array(rowWidth).fill("");
    row[nameColIndex] = fullName;
    row[emailColIndex] = email;
    row[slackIdColIndex] = slackId;
    row[deptColIndex] = department;
    row[locColIndex] = zohoLocation;
    row[empIdColIndex] = empId;
    newRows.push(row);
  });

  // Write each touched column back in one shot (only blank cells were changed).
  if (locationsFilled > 0) sheet.getRange(2, locColIndex + 1, locationValues.length, 1).setValues(locationValues);
  if (empIdsUpdated > 0) sheet.getRange(2, empIdColIndex + 1, empIdValues.length, 1).setValues(empIdValues);
  if (departmentsUpdated > 0) sheet.getRange(2, deptColIndex + 1, departmentValues.length, 1).setValues(departmentValues);
  if (slackIdsFilled > 0) sheet.getRange(2, slackIdColIndex + 1, slackIdValues.length, 1).setValues(slackIdValues);

  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, rowWidth).setValues(newRows);
  }
  SpreadsheetApp.flush(); // so the PMS sync below sees the rows just appended

  // Refresh the PMS Level column off the back of the employee sync, so new hires
  // and level changes are picked up on the same cadence. Best-effort: a PMS
  // access failure must not fail the employee sync itself.
  let pmsLevelSync = null;
  try {
    pmsLevelSync = syncPmsLevelsToLog();
  } catch (pmsError) {
    Logger.log(`PMS level sync skipped: ${pmsError.message}`);
    logToDumpSheet(`PMS level sync skipped: ${pmsError.message}`);
  }

  Logger.log(`Employee sync complete. Added ${newRows.length} (Slack IDs resolved: ${slackIdsResolved}); on existing rows filled ${locationsFilled} location(s), updated ${empIdsUpdated} employee id(s), updated ${departmentsUpdated} department(s), filled ${slackIdsFilled} Slack id(s); skipped ${skipped}.`);
  return {
    added: newRows.length,
    slackIdsResolved: slackIdsResolved,
    locationsFilled: locationsFilled,
    empIdsUpdated: empIdsUpdated,
    departmentsUpdated: departmentsUpdated,
    slackIdsFilled: slackIdsFilled,
    skipped: skipped,
    pmsLevelSync: pmsLevelSync
  };
  } catch (e) {
    sendErrorAlert('Employee sync from Zoho org tree failed: ' + (e && e.message ? e.message : e), { functionName: 'syncEmployeesFromZohoOrgTree' });
    throw e;
  }
}

/**
 * Fetches and parses the org-tree employees array.
 * @return {Array<Object>} list of employee objects (empty on failure/empty).
 */
function fetchZohoOrgTreeEmployees_() {
  const url = getRequiredScriptProperty_(ZOHO_ORG_TREE_URL_PROPERTY);
  const token = getOptionalScriptProperty_(ZOHO_ORG_TREE_TOKEN_PROPERTY, "");

  const headers = {};
  if (token) {
    // Supabase Edge Functions accept the anon/service key via either header.
    headers["Authorization"] = "Bearer " + token;
    headers["apikey"] = token;
  }

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: headers,
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`org-tree endpoint returned HTTP ${code}: ${response.getContentText()}`);
  }

  const json = JSON.parse(response.getContentText());
  const employees = json && Array.isArray(json.employees) ? json.employees : [];
  Logger.log(`Fetched ${employees.length} employees (total_active: ${json.total_active}).`);
  return employees;
}
