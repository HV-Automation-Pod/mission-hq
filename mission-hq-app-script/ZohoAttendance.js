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

function getZohoAttendanceCheckOutTime_() {
  return getOptionalScriptProperty_("ZOHO_ATTENDANCE_CHECKOUT_TIME", ZOHO_ATTENDANCE_DEFAULT_CHECKOUT_TIME);
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

  // Both ends are sent: Zoho derives worked hours from the pair, and a check-in
  // on its own leaves the day at 0 hours, which the muster roll marks Absent.
  const checkIn = `${dateString} ${getZohoAttendanceCheckInTime_()}`;
  const checkOut = `${dateString} ${getZohoAttendanceCheckOutTime_()}`;

  const records = [];
  const details = []; // index-aligned with records: who each one is, for logging
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

    const record = { checkIn: checkIn, checkOut: checkOut };
    const site = siteColIndex !== -1 && data[i][siteColIndex] ? data[i][siteColIndex].toString().trim() : "";
    if (site) record.location = site; // Geographic site from the Log's Location column (e.g. Bengaluru).

    const empId = empIdColIndex !== -1 && data[i][empIdColIndex] ? data[i][empIdColIndex].toString().trim() : "";
    if (empId) {
      record.empId = empId;
    } else {
      record.emailId = email;
    }
    records.push(record);
    details.push({
      row: i + 1,
      name: name,
      email: email,
      empId: empId,
      status: status,
      site: site,
      identifiedBy: empId ? "empId" : "emailId"
    });
  }

  return { records: records, details: details, skipped: skipped };
}

/** "row 3 · <Full Name> · <email> · empId <id> · Office · Bengaluru" */
function describeAttendanceRecord_(detail) {
  if (!detail) return "(no detail)";
  const identifier = detail.empId ? `empId ${detail.empId}` : `emailId ${detail.email}`;
  return `row ${detail.row} · ${detail.name || "(no name)"} · ${detail.email} · ${identifier} · ` +
    `${detail.status}${detail.site ? " · " + detail.site : ""}`;
}

function getZohoAttendanceBatchSize_() {
  const configured = parseInt(
    getOptionalScriptProperty_("ZOHO_ATTENDANCE_BATCH_SIZE", String(ZOHO_ATTENDANCE_DEFAULT_BATCH_SIZE)),
    10
  );
  return isNaN(configured) || configured < 1 ? ZOHO_ATTENDANCE_DEFAULT_BATCH_SIZE : configured;
}

/**
 * POSTs attendance records to the Zoho Bulk Import API, grouped by identifier
 * type and then chunked into batches.
 *
 * Any array containing an `emailId` record is rejected — the whole request 400s
 * with a generic code 7200 "API invocation failed" naming no field, so one bad
 * record takes down the batch it travels in. Established by probe on
 * 2026-08-05: 50 mixed records failed, the same 50 minus the single emailId row
 * passed, and that emailId row then failed alone in a batch of one.
 *
 * Hence: group by identifier so an emailId record cannot poison the empId
 * batches, and treat an emailId failure as non-fatal — those rows have a blank
 * Employee ID, they are few, and losing one must not cost the other 237. Fix
 * them at the source by filling Employee ID (Sync Employees from Zoho) rather
 * than expecting emailId to start working.
 */
function pushZohoAttendanceBulkImport_(records, details) {
  const batchSize = getZohoAttendanceBatchSize_();
  const groups = [
    { key: "empId", records: [], details: [] },
    { key: "emailId", records: [], details: [] }
  ];

  records.forEach((record, index) => {
    const group = record.empId ? groups[0] : groups[1];
    group.records.push(record);
    group.details.push(details ? details[index] : null);
  });

  Logger.log(
    `Zoho bulk import: ${groups[0].records.length} empId record(s), ` +
    `${groups[1].records.length} emailId record(s), batch size ${batchSize}`
  );

  const responses = [];
  let pushed = 0;
  const notPushed = [];

  groups.forEach(group => {
    if (group.records.length === 0) return;

    const batches = [];
    const batchDetails = [];
    for (let i = 0; i < group.records.length; i += batchSize) {
      batches.push(group.records.slice(i, i + batchSize));
      batchDetails.push(group.details.slice(i, i + batchSize));
    }

    batches.forEach((batch, index) => {
      if (responses.length > 0 || index > 0) Utilities.sleep(ZOHO_ATTENDANCE_BATCH_PAUSE_MS);
      Logger.log(`Bulk import [${group.key}] batch ${index + 1}/${batches.length}: ${batch.length} record(s)`);
      try {
        responses.push(pushZohoAttendanceBatch_(batch));
        pushed += batch.length;
      } catch (error) {
        Logger.log(`Bulk import [${group.key}] batch ${index + 1}/${batches.length} FAILED (${batch.length} records)`);
        (batchDetails[index] || []).forEach(detail => {
          Logger.log(`  not pushed: ${describeAttendanceRecord_(detail)}`);
          if (detail) notPushed.push(detail);
        });

        if (group.key === "empId") {
          // The bulk of the org — a failure here is a real problem, and earlier
          // batches already reached Zoho, so say so before stopping.
          throw new Error(`${group.key} batch ${index + 1} of ${batches.length}: ${error.message}`);
        }
        Logger.log(
          `Continuing — these rows have a blank Employee ID. Run "Sync Employees from Zoho" ` +
          `to fill it, then re-run this date.`
        );
      }
    });
  });

  return {
    batches: responses.length,
    pushed: pushed,
    notPushed: notPushed,
    responseCode: responses.length ? responses[responses.length - 1].responseCode : null,
    responseText: responses.map(response => response.responseText).join(" | "),
    url: responses.length ? responses[responses.length - 1].url : ""
  };
}

/** Sends one batch, trying each domain/path until one succeeds. */
function pushZohoAttendanceBatch_(records) {
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
  logAttendanceRecordDetails_(built);
  const result = pushZohoAttendanceBulkImport_(built.records, built.details);
  Logger.log(
    `Zoho attendance push completed for ${dateString}: ${result.pushed} of ${built.records.length} sent, ` +
    `${result.notPushed.length} rejected, ${built.skipped.length} skipped (blank/Pending)`
  );

  return {
    success: true,
    date: dateString,
    pushed: result.pushed,
    notPushed: result.notPushed,
    skipped: built.skipped.length,
    skippedDetails: built.skipped,
    response: result.responseText
  };
}

/**
 * Yesterday's date in the script timezone. Derived from the timezone-formatted
 * date rather than by subtracting from a raw Date, so a run near midnight in a
 * different server timezone cannot land on the wrong day.
 */
function getZohoAttendanceSyncDate_() {
  const tz = Session.getScriptTimeZone();
  const parts = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd").split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  date.setDate(date.getDate() - 1);
  return Utilities.formatDate(date, tz, "yyyy-MM-dd");
}

/** True when the MissionHQ Log has a column for that date. */
function hasMissionHqDateColumn_(dateString) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(header => header.toString().trim());
  return headers.indexOf(dateString) !== -1;
}

/**
 * Pushes YESTERDAY's attendance — the day is complete by then, whereas pushing
 * today would send a half-finished day (most rows still "Pending").
 *
 * A missing date column is a normal no-op, not an error: it means no prompts
 * went out that day (weekend or holiday).
 */
function syncYesterdayAttendanceToZoho() {
  const syncDate = getZohoAttendanceSyncDate_();
  if (!hasMissionHqDateColumn_(syncDate)) {
    const message = `No ${syncDate} column in ${CANDIDATE_SHEET_NAME} — weekend, holiday, or no prompts sent.`;
    Logger.log(`Zoho attendance push skipped: ${message}`);
    return { success: true, date: syncDate, pushed: 0, skipped: 0, message: message };
  }
  return syncAttendanceToZohoForDate(syncDate);
}


/**
 * Diagnostic: one record works but a batch of 50 does not, so something in the
 * larger set is being rejected. This runs a fixed set of probes that separate
 * the three candidates — batch size, the `location` value, and mixing
 * empId with emailId in one array — instead of guessing one per 5-minute
 * rate-limit window.
 *
 * Costs 6 API calls; the endpoint allows 10 per 5-minute lock.
 */
function diagnoseZohoAttendancePush() {
  const syncDate = getZohoAttendanceSyncDate_();
  const built = buildZohoAttendanceRecordsForDate_(syncDate);
  if (built.records.length < 50) {
    Logger.log(`Only ${built.records.length} record(s) for ${syncDate}; probes assume at least 50.`);
  }

  const first = count => built.records.slice(0, count);
  const stripLocation = records => records.map(record => {
    const copy = { checkIn: record.checkIn, checkOut: record.checkOut };
    if (record.empId) copy.empId = record.empId;
    if (record.emailId) copy.emailId = record.emailId;
    return copy;
  });
  const empIdOnly = records => records.filter(record => !!record.empId);
  const singleLocation = records => records.filter(record => record.location === "Bengaluru");

  const probes = [
    { name: "10 records, as-is", records: first(10) },
    { name: "25 records, as-is", records: first(25) },
    { name: "50 records, as-is (known failure)", records: first(50) },
    { name: "50 records, location field removed", records: stripLocation(first(50)) },
    { name: "50 records, empId only (no emailId rows)", records: empIdOnly(first(60)).slice(0, 50) },
    { name: "50 records, Bengaluru only", records: singleLocation(built.records).slice(0, 50) }
  ];

  const results = [];
  probes.forEach((probe, index) => {
    if (index > 0) Utilities.sleep(ZOHO_ATTENDANCE_BATCH_PAUSE_MS);
    if (probe.records.length === 0) {
      results.push(`SKIP  ${probe.name} (no records matched)`);
      return;
    }
    try {
      pushZohoAttendanceBatch_(probe.records);
      results.push(`PASS  ${probe.name} (${probe.records.length})`);
    } catch (error) {
      results.push(`FAIL  ${probe.name} (${probe.records.length})`);
    }
  });

  Logger.log("═══ Zoho attendance push diagnosis ═══");
  results.forEach(line => Logger.log("  " + line));
  Logger.log(
    "Reading it: 10/25 pass but 50 fails -> size limit, lower ZOHO_ATTENDANCE_BATCH_SIZE. " +
    "50 as-is fails but 'location removed' passes -> a Location value is not a valid Zoho site. " +
    "50 as-is fails but 'empId only' passes -> empId and emailId cannot be mixed in one array. " +
    "NOTE: probes that PASS have really written check-ins to Zoho for those people."
  );
  return results;
}

/**
 * Dry run: logs exactly what would be sent for yesterday without calling Zoho.
 */
function testLogZohoAttendancePayload() {
  const syncDate = getZohoAttendanceSyncDate_();
  if (!hasMissionHqDateColumn_(syncDate)) {
    Logger.log(`Zoho attendance dry run: no ${syncDate} column in ${CANDIDATE_SHEET_NAME} — nothing to send.`);
    return { records: [], skipped: [] };
  }
  const built = buildZohoAttendanceRecordsForDate_(syncDate);
  Logger.log(`Zoho attendance dry run for ${syncDate}: ${built.records.length} record(s) would be sent`);
  logAttendanceRecordDetails_(built);
  Logger.log(`Payload: ${JSON.stringify(built.records)}`);
  Logger.log(`Skipped (${built.skipped.length}): ${JSON.stringify(built.skipped)}`);
  return built;
}

/**
 * Logs who is in the payload, and a tally by status and by identifier, so a run
 * can be checked against the sheet without reading 237 opaque empIds.
 */
function logAttendanceRecordDetails_(built) {
  const byStatus = {};
  let byEmpId = 0;
  let byEmail = 0;

  built.details.forEach(detail => {
    byStatus[detail.status] = (byStatus[detail.status] || 0) + 1;
    if (detail.identifiedBy === "empId") byEmpId++;
    else byEmail++;
  });

  Logger.log(`Identified by empId: ${byEmpId}, by emailId: ${byEmail}`);
  Logger.log(`Statuses pushed: ${JSON.stringify(byStatus)}`);
  Logger.log("Records:");
  built.details.forEach(detail => Logger.log(`  ${describeAttendanceRecord_(detail)}`));
}
