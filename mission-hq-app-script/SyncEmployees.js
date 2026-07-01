const ZOHO_ORG_TREE_URL_PROPERTY = "ZOHO_ORG_TREE_URL";
const ZOHO_ORG_TREE_TOKEN_PROPERTY = "ZOHO_ORG_TREE_TOKEN";

/**
 * Fetches all active employees from the Zoho org-tree endpoint and appends
 * Full Name / Email Address / Department rows to the "MissionHQ Log" sheet.
 *
 * Idempotent: rows whose email already exists in the sheet are skipped, so it is
 * safe to run repeatedly without creating duplicates.
 */
function syncEmployeesFromZohoOrgTree() {
  const employees = fetchZohoOrgTreeEmployees_();
  if (!employees.length) {
    Logger.log("No employees returned from org-tree endpoint.");
    return { added: 0, skipped: 0 };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${CANDIDATE_SHEET_NAME}" not found`);
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const nameColIndex = headers.indexOf("Full Name");
  const emailColIndex = headers.indexOf("Email Address");
  const deptColIndex = headers.indexOf("Department");
  if (nameColIndex === -1 || emailColIndex === -1 || deptColIndex === -1) {
    throw new Error(
      'Required columns "Full Name", "Email Address" or "Department" not found in header row'
    );
  }

  // Build a set of emails already present in the sheet (case-insensitive).
  const existingEmails = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const emailValues = sheet.getRange(2, emailColIndex + 1, lastRow - 1, 1).getValues();
    emailValues.forEach(row => {
      const email = row[0]?.toString().trim().toLowerCase();
      if (email) existingEmails.add(email);
    });
  }

  // Width of the row block we write (up to the right-most of the 3 target columns).
  const rowWidth = Math.max(nameColIndex, emailColIndex, deptColIndex) + 1;

  const newRows = [];
  let skipped = 0;
  employees.forEach(emp => {
    const email = (emp.email || "").toString().trim();
    const emailKey = email.toLowerCase();
    if (!emailKey || existingEmails.has(emailKey)) {
      skipped++;
      return;
    }
    existingEmails.add(emailKey); // guard against duplicates within the payload itself

    const fullName = [emp.first_name, emp.last_name]
      .map(part => (part || "").toString().trim())
      .filter(Boolean)
      .join(" ");
    const department = (emp.department || "").toString().trim();

    const row = new Array(rowWidth).fill("");
    row[nameColIndex] = fullName;
    row[emailColIndex] = email;
    row[deptColIndex] = department;
    newRows.push(row);
  });

  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, rowWidth).setValues(newRows);
  }

  Logger.log(`Employee sync complete. Added ${newRows.length}, skipped ${skipped} (already present).`);
  return { added: newRows.length, skipped: skipped };
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
