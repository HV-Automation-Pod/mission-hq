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

function extractZohoLeaveEmail_(record) {
  const directEmail = getNestedZohoValue_(record, [
    "TeamEmailID",
    "EmailID",
    "Email_ID",
    "Employee Email",
    "Employee_Email",
    "email",
    "Email"
  ]);
  if (directEmail && typeof directEmail === "string" && directEmail.indexOf("@") !== -1) {
    return directEmail.trim().toLowerCase();
  }

  const employee = getNestedZohoValue_(record, [
    "Employee_ID",
    "employee",
    "Employee",
    "EmployeeID"
  ]);
  if (employee && typeof employee === "object") {
    const nestedEmail = getNestedZohoValue_(employee, [
      "EmailID",
      "Email_ID",
      "email",
      "Email",
      "mailid"
    ]);
    if (nestedEmail && typeof nestedEmail === "string" && nestedEmail.indexOf("@") !== -1) {
      return nestedEmail.trim().toLowerCase();
    }
  }

  return "";
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
  const fromValue = getNestedZohoValue_(record, [
    "From",
    "FromDate",
    "From_Date",
    "StartDate",
    "Start_Date",
    "Date"
  ]);
  const toValue = getNestedZohoValue_(record, [
    "To",
    "ToDate",
    "To_Date",
    "EndDate",
    "End_Date",
    "Date"
  ]);

  const fromDate = parseZohoPeopleDate_(fromValue);
  const toDate = parseZohoPeopleDate_(toValue) || fromDate;
  if (!fromDate || !toDate) return false;

  const from = formatZohoPeopleDate_(fromDate);
  const to = formatZohoPeopleDate_(toDate);
  return from <= dateString && dateString <= to;
}

function getZohoPeopleLeaveEmailsForDate(dateString) {
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
  const emails = new Set();

  records.forEach(record => {
    if (!isZohoLeaveApproved_(record)) return;
    if (!isZohoLeaveOnDate_(record, dateString)) return;

    const email = extractZohoLeaveEmail_(record);
    if (email) {
      emails.add(email);
    } else {
      Logger.log(`Zoho leave record has no extractable email: ${JSON.stringify(record)}`);
    }
  });

  return emails;
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
      email: extractZohoLeaveEmail_(record),
      name: getNestedZohoValue_(record, [
        "Employee",
        "EmployeeName",
        "Employee_Name",
        "Name",
        "employeeName"
      ]),
      from: getNestedZohoValue_(record, [
        "From",
        "FromDate",
        "From_Date",
        "StartDate",
        "Start_Date",
        "Date"
      ]),
      to: getNestedZohoValue_(record, [
        "To",
        "ToDate",
        "To_Date",
        "EndDate",
        "End_Date",
        "Date"
      ]),
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

function logZohoPeopleLeavesForDates_(label, dates, includeRawDebug) {
  Logger.log(`===== Zoho People Leaves: ${label} =====`);
  if (includeRawDebug) {
    debugLogZohoPeopleRawLeaveRecords_();
  }
  dates.forEach(dateString => {
    const leaves = getZohoPeopleLeaveRecordsForDateAndStatuses_(dateString, ["APPROVED", "PENDING"]);
    Logger.log(`${dateString}: ${leaves.length} leave record(s)`);

    leaves.forEach(leave => {
      Logger.log(JSON.stringify({
        date: dateString,
        name: leave.name,
        email: leave.email,
        from: leave.from,
        to: leave.to,
        status: leave.status
      }));
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
  const emailColIndex = headers.indexOf("Email Address");
  const dateColIndex = headers.indexOf(dateString);

  if (emailColIndex === -1) throw new Error("Column 'Email Address' not found");
  if (dateColIndex === -1) throw new Error(`Date column ${dateString} not found`);

  const leaveEmails = getZohoPeopleLeaveEmailsForDate(dateString);
  console.log(leaveEmails)
  let updated = 0;

  for (let i = 1; i < data.length; i++) {
    const email = data[i][emailColIndex] ? data[i][emailColIndex].toString().trim().toLowerCase() : "";
    if (!email || !leaveEmails.has(email)) continue;

    const currentStatus = data[i][dateColIndex] ? data[i][dateColIndex].toString().trim() : "";
    if (currentStatus && currentStatus !== "Pending" && currentStatus !== "Leave") {
      Logger.log(`Skipping Zoho leave overwrite for ${email} on ${dateString}; existing status is ${currentStatus}`);
      continue;
    }

    if (currentStatus !== "Leave") {
      sheet.getRange(i + 1, dateColIndex + 1).setValue("Leave");
      updated++;
    }
  }

  if (updated > 0) SpreadsheetApp.flush();
  Logger.log(`Zoho People leave sync for ${dateString}: ${updated} rows marked Leave, ${leaveEmails.size} leave emails found.`);

  return {
    success: true,
    date: dateString,
    leaveEmails: Array.from(leaveEmails),
    updated: updated
  };
}

function syncTodayZohoPeopleLeaves() {
  const todayDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return syncZohoPeopleLeavesForDate(todayDate);
}
