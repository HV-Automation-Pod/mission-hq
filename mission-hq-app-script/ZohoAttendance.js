/**
 * Pushes MissionHQ attendance into Zoho People via the Attendance Bulk Import
 * API. Phase 1 marks who was present each day by sending a nominal check-in
 * only; real check-out/hours are a later phase.
 *
 * Reuses the Zoho OAuth + domain-fallback plumbing in ZohoPeople.js.
 */

function getZohoAttendanceCheckInTime_() {
  return getOptionalScriptProperty_("ZOHO_ATTENDANCE_CHECKIN_TIME", ZOHO_ATTENDANCE_DEFAULT_CHECKIN_TIME);
}

function findColumnIndexByCandidates_(headers, candidates) {
  const normalized = headers.map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const candidate of candidates) {
    const target = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    const index = normalized.indexOf(target);
    if (index !== -1) return index;
  }
  return -1;
}

function isZohoAttendanceNonPushStatus_(status) {
  return ZOHO_ATTENDANCE_NON_PUSH_STATUSES.indexOf(status.toLowerCase()) !== -1;
}

/**
 * Builds the Zoho Bulk Import payload for a date from the MissionHQ Log sheet.
 * Returns { records, skipped } where records is the JSON array to POST.
 */
function buildZohoAttendanceRecordsForDate_(dateString) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(header => header.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  const nameColIndex = headers.indexOf("Full Name");
  const dateColIndex = headers.indexOf(dateString);
  const empIdColIndex = findColumnIndexByCandidates_(headers, ZOHO_ATTENDANCE_EMPID_COLUMNS);
  const siteColIndex = findColumnIndexByCandidates_(headers, ZOHO_ATTENDANCE_SITE_COLUMNS);

  if (emailColIndex === -1) throw new Error("Column 'Email Address' not found");
  if (dateColIndex === -1) throw new Error(`Date column ${dateString} not found`);

  const checkIn = `${dateString} ${getZohoAttendanceCheckInTime_()}`;

  const records = [];
  const skipped = [];

  for (let i = 1; i < data.length; i++) {
    const email = data[i][emailColIndex] ? data[i][emailColIndex].toString().trim().toLowerCase() : "";
    if (!email) continue;

    const status = data[i][dateColIndex] ? data[i][dateColIndex].toString().trim() : "";
    const name = nameColIndex === -1 ? "" : data[i][nameColIndex].toString().trim();

    // Push every real status; skip only blank (no response) and Pending.
    if (!status || isZohoAttendanceNonPushStatus_(status)) {
      if (status) skipped.push({ email: email, name: name, status: status });
      continue;
    }

    const record = { checkIn: checkIn };
    const site = siteColIndex !== -1 && data[i][siteColIndex] ? data[i][siteColIndex].toString().trim() : "";
    if (site) record.location = site; // Geographic site from the Log's Location column (e.g. Bengaluru).

    const empId = empIdColIndex !== -1 && data[i][empIdColIndex] ? data[i][empIdColIndex].toString().trim() : "";
    if (empId) {
      record.empId = empId;
    } else {
      record.emailId = email;
    }
    records.push(record);
  }

  return { records: records, skipped: skipped };
}

/**
 * POSTs an attendance record array to the Zoho Bulk Import API, trying each
 * configured domain until one succeeds.
 */
function pushZohoAttendanceBulkImport_(records) {
  const payload = {
    data: JSON.stringify(records),
    dateFormat: ZOHO_ATTENDANCE_DATETIME_FORMAT
  };
  const errors = [];

  for (const domain of getZohoPeopleApiDomains_()) {
    for (const path of ZOHO_PEOPLE_ATTENDANCE_BULK_PATHS) {
      const url = `${domain}${path}`;
      try {
        const response = UrlFetchApp.fetch(url, {
          method: "post",
          payload: payload,
          headers: {
            Authorization: `Zoho-oauthtoken ${getZohoPeopleAccessToken()}`
          },
          muteHttpExceptions: true
        });

        const responseCode = response.getResponseCode();
        const responseText = response.getContentText() || "";

        if (responseCode < 200 || responseCode >= 300) {
          throw new Error(`HTTP ${responseCode}: ${responseText.substring(0, 500)}`);
        }
        if (responseText.indexOf("Invalid Ticket") !== -1 || responseText.toLowerCase().indexOf("invalid oauth") !== -1) {
          throw new Error(`Auth rejected: ${responseText.substring(0, 200)}`);
        }

        Logger.log(`Zoho attendance bulk import success via ${url}: ${responseText.substring(0, 500)}`);
        return { url: url, responseCode: responseCode, responseText: responseText };
      } catch (error) {
        errors.push(`${url} -> ${error.message}`);
      }
    }
  }

  throw new Error(`Zoho attendance bulk import failed for all endpoints: ${errors.join(" | ")}`);
}

/**
 * Pushes attendance for a single date and returns a summary.
 */
function syncAttendanceToZohoForDate(dateString) {
  Logger.log(`Zoho attendance push started for ${dateString}`);
  const built = buildZohoAttendanceRecordsForDate_(dateString);

  if (built.records.length === 0) {
    Logger.log(`Zoho attendance push for ${dateString}: no present employees to send`);
    return {
      success: true,
      date: dateString,
      pushed: 0,
      skipped: built.skipped.length,
      message: "No present employees to push"
    };
  }

  Logger.log(`Zoho attendance push for ${dateString}: sending ${built.records.length} record(s)`);
  const result = pushZohoAttendanceBulkImport_(built.records);
  Logger.log(`Zoho attendance push completed for ${dateString}: ${built.records.length} sent, ${built.skipped.length} skipped`);

  return {
    success: true,
    date: dateString,
    pushed: built.records.length,
    skipped: built.skipped.length,
    skippedDetails: built.skipped,
    response: result.responseText
  };
}

function syncTodayAttendanceToZoho() {
  const todayDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return syncAttendanceToZohoForDate(todayDate);
}

/**
 * Dry run: logs exactly what would be sent for today without calling Zoho.
 */
function testLogZohoAttendancePayload() {
  const todayDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const built = buildZohoAttendanceRecordsForDate_(todayDate);
  Logger.log(`Zoho attendance dry run for ${todayDate}: ${built.records.length} record(s) would be sent`);
  Logger.log(`Payload: ${JSON.stringify(built.records)}`);
  Logger.log(`Skipped (${built.skipped.length}): ${JSON.stringify(built.skipped)}`);
  return built;
}
