function getZohoPeopleClientId_() {
  return getRequiredScriptProperty_(ZOHO_CLIENT_ID_PROPERTY);
}

function getZohoPeopleClientSecret_() {
  return getRequiredScriptProperty_(ZOHO_CLIENT_SECRET_PROPERTY);
}

function getZohoPeopleRedirectUri_() {
  return getRequiredScriptProperty_(ZOHO_PEOPLE_REDIRECT_URI_PROPERTY);
}

function getZohoPeopleAccountsUrl_() {
  return getOptionalScriptProperty_("ZOHO_PEOPLE_ACCOUNTS_URL", ZOHO_PEOPLE_ACCOUNTS_URL);
}

function getZohoPeopleApiDomain_() {
  return getOptionalScriptProperty_("ZOHO_PEOPLE_API_DOMAIN", ZOHO_PEOPLE_API_DOMAIN);
}

function getZohoPeopleApiDomains_() {
  const configuredDomain = getZohoPeopleApiDomain_();
  const domains = [configuredDomain].concat(ZOHO_PEOPLE_API_DOMAIN_FALLBACKS || []);
  return domains.filter((domain, index) => domain && domains.indexOf(domain) === index);
}

function buildZohoPeopleAuthorizationUrl_() {
  const scope = ZOHO_PEOPLE_SCOPES.join(",");

  return `${getZohoPeopleAccountsUrl_()}/oauth/v2/auth?scope=${encodeURIComponent(scope)}&client_id=${encodeURIComponent(getZohoPeopleClientId_())}&response_type=code&access_type=offline&redirect_uri=${encodeURIComponent(getZohoPeopleRedirectUri_())}&prompt=consent`;
}

function startZohoPeopleAuthorization() {
  const authUrl = buildZohoPeopleAuthorizationUrl_();

  const html = HtmlService.createHtmlOutput(`
    <div style="font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #202124;">
      <h3 style="margin-top:0;">Authorize Zoho People</h3>
      <p style="font-size: 14px; line-height: 1.5;">
        Click the button below to grant MissionHQ read access to Zoho People leave data.
      </p>
      <a href="${authUrl}" target="_blank"
         style="display:inline-block; margin-top:8px; padding:10px 18px;
                background:#1a73e8; color:#fff; text-decoration:none;
                border-radius:4px; font-weight:600; font-size:14px;">
        Authorize Zoho People
      </a>
      <p style="margin-top: 18px; font-size: 12px; color: #5f6368;">
        After you see the success page, close this dialog.
      </p>
      <p style="margin: 16px 0 6px; font-size: 12px; color: #5f6368;">
        Authorization link:
      </p>
      <textarea readonly
        style="width:100%; height:96px; box-sizing:border-box; padding:8px;
               font-family: monospace; font-size:11px; border:1px solid #dadce0;
               border-radius:4px; color:#202124;">${authUrl}</textarea>
    </div>
  `).setWidth(560).setHeight(380);

  SpreadsheetApp.getUi().showModalDialog(html, "Zoho People Authorization");
  Logger.log(authUrl);
  return authUrl;
}

function exchangeZohoPeopleCodeForTokens_(authCode) {
  const tokenUrl = `${getZohoPeopleAccountsUrl_()}/oauth/v2/token`;
  const payload = {
    code: authCode,
    client_id: getZohoPeopleClientId_(),
    client_secret: getZohoPeopleClientSecret_(),
    redirect_uri: getZohoPeopleRedirectUri_(),
    grant_type: "authorization_code"
  };

  const response = UrlFetchApp.fetch(tokenUrl, {
    method: "post",
    payload: payload,
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText() || "{}");

  if (result.error) {
    throw new Error(`${result.error}: ${result.error_description || "Zoho People authorization failed"}`);
  }
  if (!result.refresh_token) {
    throw new Error("Zoho People did not return a refresh token. Re-authorize with prompt=consent.");
  }

  return result;
}

function handleZohoPeopleOAuthCallback_(authCode) {
  const tokens = exchangeZohoPeopleCodeForTokens_(authCode);
  const props = PropertiesService.getScriptProperties();
  props.setProperty(ZOHO_REFRESH_TOKEN_PROPERTY, tokens.refresh_token);

  return HtmlService.createHtmlOutput(`
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, Arial, sans-serif;
        color: #202124;
        background: #fff;
        text-align: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .card { max-width: 480px; }
      h2 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 6px 0; color: #5f6368; font-size: 14px; line-height: 1.5; }
    </style>
    <div class="card">
      <h2>Authorization Successful</h2>
      <p>Zoho People refresh token has been saved.</p>
      <p>You can close this window and run MissionHQ leave sync.</p>
    </div>
    <script>
      setTimeout(function() { window.close(); }, 3000);
    </script>
  `);
}

function getZohoPeopleAccessToken() {
  const props = PropertiesService.getScriptProperties();
  const refreshToken = props.getProperty(ZOHO_REFRESH_TOKEN_PROPERTY);

  if (!refreshToken) {
    throw new Error(`${ZOHO_REFRESH_TOKEN_PROPERTY} missing. Run startZohoPeopleAuthorization() first.`);
  }

  const cachedToken = props.getProperty(ZOHO_ACCESS_TOKEN_PROPERTY);
  const expiresAt = props.getProperty(ZOHO_ACCESS_TOKEN_EXPIRES_PROPERTY);
  const now = new Date().getTime();

  if (cachedToken && expiresAt && now < (parseInt(expiresAt, 10) - 60000)) {
    return cachedToken;
  }

  const tokenUrl = `${getZohoPeopleAccountsUrl_()}/oauth/v2/token`;
  const response = UrlFetchApp.fetch(tokenUrl, {
    method: "post",
    payload: {
      refresh_token: refreshToken,
      client_id: getZohoPeopleClientId_(),
      client_secret: getZohoPeopleClientSecret_(),
      grant_type: "refresh_token"
    },
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText() || "{}");

  if (result.error) {
    throw new Error(`${result.error}: ${result.error_description || "Failed to refresh Zoho People token"}`);
  }
  if (!result.access_token) {
    throw new Error("Zoho People refresh response did not include access_token.");
  }

  const expiresIn = result.expires_in || 3600;
  props.setProperty(ZOHO_ACCESS_TOKEN_PROPERTY, result.access_token);
  props.setProperty(ZOHO_ACCESS_TOKEN_EXPIRES_PROPERTY, String(now + (expiresIn * 1000)));

  return result.access_token;
}

function buildZohoPeopleQuery_(queryParams) {
  const query = Object.keys(queryParams || {})
    .filter(key => queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== "")
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
    .join("&");
  return query ? `?${query}` : "";
}

function fetchZohoPeopleJsonUrl_(url) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: `Zoho-oauthtoken ${getZohoPeopleAccessToken()}`
    },
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  let result = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error(`Zoho People returned non-JSON response from ${url}: ${responseText.substring(0, 500)}`);
  }

  if (responseCode < 200 || responseCode >= 300) {
    throw new Error(`Zoho People API ${path} failed with HTTP ${responseCode}: ${JSON.stringify(result)}`);
  }

  Logger.log(`Zoho People API success: ${url}`);
  return result;
}

function fetchZohoPeopleRecords_(paths, queryParams) {
  const pathList = Array.isArray(paths) ? paths : [paths];
  const query = buildZohoPeopleQuery_(queryParams);
  const errors = [];

  for (const domain of getZohoPeopleApiDomains_()) {
    for (const path of pathList) {
      const url = `${domain}${path}${query}`;
      try {
        return fetchZohoPeopleJsonUrl_(url);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  throw new Error(`Zoho People API failed for all endpoint formats: ${errors.join(" | ")}`);
}

function normalizeZohoPeopleRecordList_(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.data)) return response.data;
  if (response.records && typeof response.records === "object") {
    return Object.keys(response.records).map(key => response.records[key]);
  }
  if (response.response && Array.isArray(response.response.result)) return response.response.result;
  if (response.response && response.response.result && Array.isArray(response.response.result.data)) {
    return response.response.result.data;
  }

  if (response.response && response.response.result && typeof response.response.result === "object") {
    const records = [];
    Object.keys(response.response.result).forEach(key => {
      const value = response.response.result[key];
      if (Array.isArray(value)) {
        records.push.apply(records, value);
      } else if (value && typeof value === "object") {
        records.push(value);
      }
    });
    return records;
  }

  return [];
}

function getNestedZohoValue_(record, keys) {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }

  for (const key of keys) {
    if (!record || typeof record !== "object") continue;
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const foundKey = Object.keys(record).find(candidate => candidate.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedKey);
    if (foundKey && record[foundKey] !== undefined && record[foundKey] !== null && record[foundKey] !== "") {
      return record[foundKey];
    }
  }

  return "";
}

// Zoho leave records carry no employee email — only an `EmployeeId` (the same
// `emp_id` SyncEmployees writes to the sheet), a display name (`Employee`),
// `ZUID` and `Employee.ID`. We join a leave to the sheet by emp id, falling back
// to name for rows not yet carrying an emp id. Both keys are normalized so
// trivial formatting/case differences still match.
function normalizeEmpId_(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function normalizeLeaveName_(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractZohoLeaveName_(record) {
  const name = getNestedZohoValue_(record, [
    "Employee",
    "EmployeeName",
    "Employee_Name",
    "Name",
    "employeeName"
  ]);
  return typeof name === "string" ? name.trim() : "";
}

function extractZohoLeaveEmpId_(record) {
  return normalizeEmpId_(getNestedZohoValue_(record, ["EmployeeId", "Employee_ID", "EmployeeID"]));
}

// Returns { empId, name, rawName } for each approved leave covering the date.
function getZohoPeopleLeaveIdentitiesForDate(dateString) {
  const response = fetchZohoPeopleRecords_(ZOHO_PEOPLE_LEAVE_RECORD_PATHS, {
    from: dateString,
    to: dateString,
    dateFormat: "yyyy-MM-dd",
    approvalStatus: JSON.stringify(["APPROVED"]),
    dataSelect: "ALL",
    startIndex: 0,
    limit: 200
  });
  const records = normalizeZohoPeopleRecordList_(response);
  const identities = [];

  records.forEach(record => {
    if (!isZohoLeaveApproved_(record)) return;
    if (!isZohoLeaveOnDate_(record, dateString)) return;

    const rawName = extractZohoLeaveName_(record);
    identities.push({
      empId: extractZohoLeaveEmpId_(record),
      name: normalizeLeaveName_(rawName),
      rawName: rawName,
      toDate: extractZohoLeaveToDate_(record) // last day of this leave, for the Slack status expiry
    });
  });

  return identities;
}

/** yyyy-MM-dd of a leave's last day (falls back to the start day for single-day leaves). */
function extractZohoLeaveToDate_(record) {
  // Zoho People returns plain "From"/"To" (confirmed against live records).
  const fromDate = parseZohoPeopleDate_(getNestedZohoValue_(record, ["From"]));
  const toDate = parseZohoPeopleDate_(getNestedZohoValue_(record, ["To"])) || fromDate;
  return toDate ? formatZohoPeopleDate_(toDate) : "";
}

function parseZohoPeopleDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashMatch) {
    return new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
  }

  const monthNames = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11
  };
  const monthNameMatch = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (monthNameMatch) {
    return new Date(Number(monthNameMatch[3]), monthNames[monthNameMatch[2].toLowerCase()], Number(monthNameMatch[1]));
  }

  const parsed = new Date(raw);
  return isNaN(parsed) ? null : parsed;
}

function formatZohoPeopleDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function isZohoLeaveApproved_(record) {
  const status = String(getNestedZohoValue_(record, [
    "ApprovalStatus",
    "Approval_Status",
    "approvalStatus",
    "Status",
    "status"
  ]) || "").toLowerCase();

  if (!status) return true;
  return status.indexOf("approved") !== -1 || status === "approve";
}

function isZohoLeaveOnDate_(record, dateString) {
  // Zoho People returns plain "From"/"To" (confirmed against live records).
  const fromValue = getNestedZohoValue_(record, ["From"]);
  const toValue = getNestedZohoValue_(record, ["To"]);

  const fromDate = parseZohoPeopleDate_(fromValue);
  const toDate = parseZohoPeopleDate_(toValue) || fromDate;
  if (!fromDate || !toDate) return false;

  const from = formatZohoPeopleDate_(fromDate);
  const to = formatZohoPeopleDate_(toDate);
  return from <= dateString && dateString <= to;
}

function getZohoPeopleLeaveRecordsForDateAndStatuses_(dateString, statuses) {
  const response = fetchZohoPeopleRecords_(ZOHO_PEOPLE_LEAVE_RECORD_PATHS, {
    from: dateString,
    to: dateString,
    dateFormat: "yyyy-MM-dd",
    approvalStatus: JSON.stringify(statuses),
    dataSelect: "ALL",
    startIndex: 0,
    limit: 200
  });
  const records = normalizeZohoPeopleRecordList_(response);

  return records
    .filter(record => isZohoLeaveOnDate_(record, dateString))
    .map(record => ({
      empId: getNestedZohoValue_(record, ["EmployeeId", "Employee_ID", "EmployeeID"]),
      name: getNestedZohoValue_(record, [
        "Employee",
        "EmployeeName",
        "Employee_Name",
        "Name",
        "employeeName"
      ]),
      from: getNestedZohoValue_(record, ["From"]),
      to: getNestedZohoValue_(record, ["To"]),
      status: getNestedZohoValue_(record, [
        "ApprovalStatus",
        "Approval_Status",
        "approvalStatus",
        "Status",
        "status"
      ]),
      raw: record
    }));
}

function debugLogZohoPeopleRawLeaveRecords_() {
  const response = fetchZohoPeopleRecords_(ZOHO_PEOPLE_LEAVE_RECORD_PATHS, {
    from: formatZohoPeopleDate_(new Date()),
    to: formatZohoPeopleDate_(new Date()),
    dateFormat: "yyyy-MM-dd",
    approvalStatus: JSON.stringify(["APPROVED"]),
    dataSelect: "ALL",
    startIndex: 0,
    limit: 10
  });
  const records = normalizeZohoPeopleRecordList_(response);

  Logger.log(`Zoho raw leave sample count: ${records.length}`);
  records.slice(0, 5).forEach((record, index) => {
    Logger.log(`Raw leave record ${index + 1} keys: ${Object.keys(record).join(", ")}`);
    Logger.log(`Raw leave record ${index + 1}: ${JSON.stringify(record)}`);
  });
}

// Builds lookups from the MissionHQ Log so a Zoho leave (emp id + name, no
// email) can be resolved to a sheet row: byEmpId and byName each map a
// normalized key -> { row (1-based), email, name, empId }.
function buildSheetEmployeeLookups_(data, headers) {
  const nameColIndex = headers.indexOf("Full Name");
  const emailColIndex = headers.indexOf("Email Address");
  const empIdColIndex = findColumnIndexByCandidates_(headers, ZOHO_ATTENDANCE_EMPID_COLUMNS);
  const slackIdColIndex = headers.indexOf(SLACK_USER_ID_COLUMN);

  const byEmpId = {};
  const byName = {};
  for (let i = 1; i < data.length; i++) {
    const name = nameColIndex === -1 ? "" : (data[i][nameColIndex] || "").toString().trim();
    const entry = {
      row: i + 1,
      name: name,
      email: emailColIndex === -1 ? "" : (data[i][emailColIndex] || "").toString().trim().toLowerCase(),
      empId: empIdColIndex === -1 ? "" : normalizeEmpId_(data[i][empIdColIndex]),
      slackId: slackIdColIndex === -1 ? "" : (data[i][slackIdColIndex] || "").toString().trim()
    };
    if (entry.empId && !byEmpId[entry.empId]) byEmpId[entry.empId] = entry;
    const nameKey = normalizeLeaveName_(name);
    if (nameKey && !byName[nameKey]) byName[nameKey] = entry;
  }
  return { byEmpId: byEmpId, byName: byName };
}

// Resolves a leave { empId, name } to a sheet entry: emp id first, name
// fallback. Returns { entry, matchBy } (entry null if unmatched).
function matchLeaveToSheet_(lookups, empKey, nameKey) {
  if (empKey && lookups.byEmpId[empKey]) return { entry: lookups.byEmpId[empKey], matchBy: "empId" };
  if (nameKey && lookups.byName[nameKey]) return { entry: lookups.byName[nameKey], matchBy: "name" };
  return { entry: null, matchBy: "none" };
}

function logZohoPeopleLeavesForDates_(label, dates, includeRawDebug) {
  Logger.log(`===== Zoho People Leaves: ${label} =====`);
  if (includeRawDebug) {
    debugLogZohoPeopleRawLeaveRecords_();
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);
  const data = sheet.getDataRange().getDisplayValues();
  const lookups = buildSheetEmployeeLookups_(data, data[0].map(h => h.toString().trim()));

  dates.forEach(dateString => {
    const leaves = getZohoPeopleLeaveRecordsForDateAndStatuses_(dateString, ["APPROVED", "PENDING"]);
    Logger.log(`${dateString}: ${leaves.length} leave record(s)`);

    leaves.forEach(leave => {
      const { entry, matchBy } = matchLeaveToSheet_(lookups, normalizeEmpId_(leave.empId), normalizeLeaveName_(leave.name));
      Logger.log(JSON.stringify({
        date: dateString,
        name: leave.name,
        empId: leave.empId,
        matchedRow: entry ? entry.row : null,
        resolvedEmail: entry ? entry.email : "",
        matchBy: matchBy,
        from: leave.from,
        to: leave.to,
        status: leave.status
      }));
      if (!entry) {
        Logger.log(`NO SHEET MATCH for Zoho leave "${leave.name}" empId=${leave.empId} on ${dateString} — would NOT be marked Leave`);
      }
    });
  });
  Logger.log(`===== End Zoho People Leaves: ${label} =====`);
}

function testLogZohoPeopleLeaves() {
  const today = new Date();
  logZohoPeopleLeavesForDates_("Today", [formatZohoPeopleDate_(today)], true);
}

function syncZohoPeopleLeavesForDate(dateString) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(header => header.toString().trim());
  const dateColIndex = headers.indexOf(dateString);
  if (dateColIndex === -1) throw new Error(`Date column ${dateString} not found`);

  Logger.log(`Zoho People leave sync started for ${dateString}`);
  const identities = getZohoPeopleLeaveIdentitiesForDate(dateString);
  Logger.log(`Zoho People leave API completed for ${dateString}: ${identities.length} approved leave(s) found`);

  const lookups = buildSheetEmployeeLookups_(data, headers);

  let updated = 0;
  const markedLeaves = [];
  const skippedLeaves = [];
  const unmatchedLeaves = [];
  const slackStatusSet = [];
  const processedRows = {};

  identities.forEach(identity => {
    const { entry, matchBy } = matchLeaveToSheet_(lookups, identity.empId, identity.name);
    if (!entry) {
      unmatchedLeaves.push({ empId: identity.empId, name: identity.rawName });
      return;
    }
    if (processedRows[entry.row]) return; // same sheet row already handled this run
    processedRows[entry.row] = true;

    const currentStatus = data[entry.row - 1][dateColIndex] ? data[entry.row - 1][dateColIndex].toString().trim() : "";
    if (currentStatus && currentStatus !== "Pending" && currentStatus !== "Leave") {
      skippedLeaves.push({ row: entry.row, name: entry.name, email: entry.email, existingStatus: currentStatus });
      return;
    }

    if (currentStatus !== "Leave") {
      sheet.getRange(entry.row, dateColIndex + 1).setValue("Leave");
      updated++;
      markedLeaves.push({ row: entry.row, name: entry.name, email: entry.email, matchBy: matchBy });
    }

    // Best-effort Slack "On leave" status, expiring at the leave's end. Attempted
    // each day of the leave, but the helper only writes when the status is empty,
    // so a multi-day leave is stamped once (day two onward sees it already set
    // and skips) and never overwrites a status the employee chose.
    if (entry.slackId) {
      const result = setSlackLeaveStatusIfEmpty_(entry.slackId, identity.toDate || dateString);
      if (result.set) {
        slackStatusSet.push({ name: entry.name, until: identity.toDate || dateString });
      } else if (result.reason && result.reason.indexOf("existing status") === -1) {
        Logger.log(`Slack leave status not set for ${entry.name}: ${result.reason}`);
      }
    }
  });

  if (updated > 0) SpreadsheetApp.flush();
  if (slackStatusSet.length > 0) {
    Logger.log(`Slack "On leave" status set for ${dateString}: ${JSON.stringify(slackStatusSet)}`);
  }
  Logger.log(`Zoho People users marked Leave for ${dateString}: ${JSON.stringify(markedLeaves)}`);
  if (skippedLeaves.length > 0) {
    Logger.log(`Zoho People leave matches skipped for ${dateString}: ${JSON.stringify(skippedLeaves)}`);
  }
  if (unmatchedLeaves.length > 0) {
    // No sheet row for this emp id / name — run Sync Employees so emp ids are
    // filled, or check the name. These people are NOT marked Leave.
    Logger.log(`Zoho People leaves with no matching sheet row for ${dateString}: ${JSON.stringify(unmatchedLeaves)}`);
  }
  Logger.log(`Zoho People leave sync completed for ${dateString}: ${updated} row(s) marked Leave, ${identities.length} approved leave(s) found.`);

  return {
    success: true,
    date: dateString,
    markedLeaves: markedLeaves,
    skippedLeaves: skippedLeaves,
    unmatchedLeaves: unmatchedLeaves,
    slackStatusSet: slackStatusSet,
    updated: updated
  };
}

function syncTodayZohoPeopleLeaves() {
  const todayDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return syncZohoPeopleLeavesForDate(todayDate);
}

// ---------------------------------------------------------------------------
// Slack "On leave" status for approved Zoho leaves
//
// Set ONCE, on the first day of a leave, with an expiry at the leave's end, so
// Slack clears it automatically. A multi-day leave is not re-stamped daily: the
// later days see a status already present and skip. We never overwrite a status
// the employee (or anything else) set — only a genuinely empty one.
//
// Setting another member's profile needs an admin user token; SLACK_USER_TOKEN
// is used. The whole thing is best-effort: a Slack failure is logged and never
// breaks the sheet leave sync.
// ---------------------------------------------------------------------------

const LEAVE_SLACK_STATUS_TEXT = "On leave";
const LEAVE_SLACK_STATUS_EMOJI = ":palm_tree:";

/** Unix seconds at the start of the day AFTER the leave ends — when Slack clears it. */
function leaveStatusExpirationEpoch_(toDateString) {
  const to = parseZohoPeopleDate_(toDateString);
  if (!to) return 0; // 0 = no expiry; better than a wrong date
  const next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0);
  return Math.floor(next.getTime() / 1000);
}

/**
 * Sets the "On leave" status for a user, but only if their status is currently
 * empty. Returns a small result object; never throws.
 */
function setSlackLeaveStatusIfEmpty_(userId, toDateString) {
  if (!userId) return { set: false, reason: "no slack id" };

  try {
    const getResp = UrlFetchApp.fetch(
      `https://slack.com/api/users.profile.get?user=${encodeURIComponent(userId)}`,
      { method: "get", headers: { Authorization: `Bearer ${SLACK_USER_TOKEN}` }, muteHttpExceptions: true }
    );
    const getJson = JSON.parse(getResp.getContentText());
    if (!getJson.ok) return { set: false, reason: `profile.get: ${getJson.error}` };

    // Treat either a set text or a set emoji as "has a status", matching the
    // edge function — do not overwrite anything the employee already chose.
    const profile = getJson.profile || {};
    const existingText = profile.status_text ? profile.status_text.toString().trim() : "";
    const existingEmoji = profile.status_emoji ? profile.status_emoji.toString().trim() : "";
    if (existingText || existingEmoji) {
      return { set: false, reason: `existing status "${existingText || existingEmoji}"` };
    }

    const payload = {
      user: userId,
      profile: {
        status_text: LEAVE_SLACK_STATUS_TEXT,
        status_emoji: LEAVE_SLACK_STATUS_EMOJI,
        status_expiration: leaveStatusExpirationEpoch_(toDateString)
      }
    };
    const setResp = UrlFetchApp.fetch("https://slack.com/api/users.profile.set", {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { Authorization: `Bearer ${SLACK_USER_TOKEN}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const setJson = JSON.parse(setResp.getContentText());
    if (!setJson.ok) return { set: false, reason: `profile.set: ${setJson.error}` };
    return { set: true, expiresAfter: toDateString };
  } catch (error) {
    return { set: false, reason: `error: ${error.message}` };
  }
}
