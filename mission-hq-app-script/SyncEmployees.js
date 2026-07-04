const ZOHO_ORG_TREE_URL_PROPERTY = "ZOHO_ORG_TREE_URL";
const ZOHO_ORG_TREE_TOKEN_PROPERTY = "ZOHO_ORG_TREE_TOKEN";

/**
 * Fetches all active employees from the Zoho org-tree endpoint and syncs them
 * into the "MissionHQ Log" sheet:
 *   - Appends Full Name / Email Address / Department / Location rows for
 *     employees whose email is not in the sheet yet.
 *   - Fills the Location column for existing rows where it is blank (never
 *     overwrites a location already set in the sheet).
 *
 * Idempotent: safe to run repeatedly without creating duplicates.
 */
function syncEmployeesFromZohoOrgTree() {
  const employees = fetchZohoOrgTreeEmployees_();
  if (!employees.length) {
    Logger.log("No employees returned from org-tree endpoint.");
    return { added: 0, skipped: 0, locationsFilled: 0 };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${CANDIDATE_SHEET_NAME}" not found`);
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const nameColIndex = headers.indexOf("Full Name");
  const emailColIndex = headers.indexOf("Email Address");
  const deptColIndex = headers.indexOf("Department");
  const locColIndex = headers.indexOf("Location");
  if (nameColIndex === -1 || emailColIndex === -1 || deptColIndex === -1 || locColIndex === -1) {
    throw new Error(
      'Required columns "Full Name", "Email Address", "Department" or "Location" not found in header row'
    );
  }

  // Map of email -> 0-based data row index for rows already in the sheet.
  const existingRowByEmail = {};
  const lastRow = sheet.getLastRow();
  let emailValues = [];
  let locationValues = [];
  if (lastRow > 1) {
    emailValues = sheet.getRange(2, emailColIndex + 1, lastRow - 1, 1).getValues();
    locationValues = sheet.getRange(2, locColIndex + 1, lastRow - 1, 1).getValues();
    emailValues.forEach((row, i) => {
      const email = row[0]?.toString().trim().toLowerCase();
      if (email && !(email in existingRowByEmail)) existingRowByEmail[email] = i;
    });
  }

  // Width of the row block we write (up to the right-most of the target columns).
  const rowWidth = Math.max(nameColIndex, emailColIndex, deptColIndex, locColIndex) + 1;

  const newRows = [];
  let skipped = 0;
  let locationsFilled = 0;
  employees.forEach(emp => {
    const email = (emp.email || "").toString().trim();
    const emailKey = email.toLowerCase();
    if (!emailKey) {
      skipped++;
      return;
    }
    const zohoLocation = (emp.location || "").toString().trim();

    if (emailKey in existingRowByEmail) {
      // Existing row: only fill Location when the sheet cell is blank.
      const rowIndex = existingRowByEmail[emailKey];
      const currentLocation = locationValues[rowIndex][0]?.toString().trim() || "";
      if (!currentLocation && zohoLocation) {
        locationValues[rowIndex][0] = zohoLocation;
        locationsFilled++;
      } else {
        skipped++;
      }
      return;
    }
    existingRowByEmail[emailKey] = -1; // guard against duplicates within the payload itself

    const fullName = [emp.first_name, emp.last_name]
      .map(part => (part || "").toString().trim())
      .filter(Boolean)
      .join(" ");
    const department = (emp.department || "").toString().trim();

    const row = new Array(rowWidth).fill("");
    row[nameColIndex] = fullName;
    row[emailColIndex] = email;
    row[deptColIndex] = department;
    row[locColIndex] = zohoLocation;
    newRows.push(row);
  });

  // Write the Location column back in one shot (only blank cells were changed).
  if (locationsFilled > 0) {
    sheet.getRange(2, locColIndex + 1, locationValues.length, 1).setValues(locationValues);
  }

  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, rowWidth).setValues(newRows);
  }

  Logger.log(`Employee sync complete. Added ${newRows.length}, filled ${locationsFilled} blank location(s), skipped ${skipped} (already present).`);
  return { added: newRows.length, skipped: skipped, locationsFilled: locationsFilled };
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
