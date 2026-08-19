function getRequiredScriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(`${key} not found in script properties`);
  }
  return value;
}

function getOptionalScriptProperty_(key, fallback) {
  return PropertiesService.getScriptProperties().getProperty(key) || fallback;
}

const CANDIDATE_SHEET_NAME = "MissionHQ Log";
const SLACK_RESPONSES_SHEET_NAME = "MissionHQ Log";
const LOCATIONS_SHEET_NAME = "Locations";
const SLACK_USER_ID_COLUMN = "Slack User ID";

// Rows with a value in this column are out of WFO attendance entirely: no daily
// prompt, no reminder, and excluded from every fortnightly summary group. Their
// history stays in the sheet — this hides them from what runs from today on, it
// never deletes anything. Any text counts and doubles as the reason
// ("Offboarded 2026-08-18", "Exception — approved by PnC"); the column is
// created automatically at the end of the sheet on the next prompt run.
const WFO_EXEMPT_COLUMN = "WFO Exempt";
// ...except these, so a stray "No" cannot silently drop someone.
const WFO_EXEMPT_FALSE_VALUES = ["no", "n", "false", "0", "-"];

function isWfoExempt_(value) {
  const text = (value === null || value === undefined ? "" : value.toString()).trim().toLowerCase();
  if (!text) return false;
  return WFO_EXEMPT_FALSE_VALUES.indexOf(text) === -1;
}

const SLACK_BOT_TOKEN = getRequiredScriptProperty_("SLACK_BOT_TOKEN");
const SLACK_USER_TOKEN = getRequiredScriptProperty_("SLACK_USER_TOKEN");
const SLACK_CHANNEL_ID = getRequiredScriptProperty_("SLACK_CHANNEL_ID");

const REMINDER_CHANNEL_ID = getRequiredScriptProperty_("REMINDER_CHANNEL_ID");
const ALERT_USER_ID = getRequiredScriptProperty_("ALERT_USER_ID");

const ZOHO_CLIENT_ID_PROPERTY = "ZOHO_CLIENT_ID";
const ZOHO_CLIENT_SECRET_PROPERTY = "ZOHO_CLIENT_SECRET";
const ZOHO_PEOPLE_REDIRECT_URI_PROPERTY = "ZOHO_PEOPLE_REDIRECT_URI";
const ZOHO_REFRESH_TOKEN_PROPERTY = "ZOHO_REFRESH_TOKEN";
const ZOHO_ACCESS_TOKEN_PROPERTY = "ZOHO_ACCESS_TOKEN";
const ZOHO_ACCESS_TOKEN_EXPIRES_PROPERTY = "ZOHO_ACCESS_TOKEN_EXPIRES";

const ZOHO_PEOPLE_ACCOUNTS_URL = "https://accounts.zoho.in";
const ZOHO_PEOPLE_API_DOMAIN = "https://people.zoho.in";
const ZOHO_PEOPLE_API_DOMAIN_FALLBACKS = [
  "https://people.zoho.in",
  "https://people.zoho.com"
];
const ZOHO_PEOPLE_LEAVE_RECORD_PATHS = [
  "/api/v2/leavetracker/leaves/records"
];

const ZOHO_PEOPLE_SCOPES = [
  "ZOHOPEOPLE.leave.READ",
  "ZOHOPEOPLE.forms.READ",
  "ZOHOPEOPLE.employee.ALL",
  "ZOHOPEOPLE.attendance.ALL"
];

// ----- Zoho People attendance push (MissionHQ -> Zoho, ZohoAttendance.js) -----
// Classic People API bulk-import endpoint (under /people/api, unlike the v2
// leave endpoint). Resolved against getZohoPeopleApiDomains_() with fallback.
const ZOHO_PEOPLE_ATTENDANCE_BULK_PATHS = [
  "/people/api/attendance/bulkImport"
];
// Zoho Bulk Import dateFormat for the check-in timestamp.
const ZOHO_ATTENDANCE_DATETIME_FORMAT = "yyyy-MM-dd HH:mm:ss";
// Records per bulk-import request. Zoho rejects oversized arrays with a generic
// HTTP 400 / code 7200 "API invocation failed", so the push is chunked.
// Override with the ZOHO_ATTENDANCE_BATCH_SIZE property.
const ZOHO_ATTENDANCE_DEFAULT_BATCH_SIZE = 50;
// Pause between batches — the bulk-import endpoint allows 10 requests per
// 5-minute lock window.
const ZOHO_ATTENDANCE_BATCH_PAUSE_MS = 2000;
// Nominal check-in/check-out times (HH:mm:ss) used when the
// ZOHO_ATTENDANCE_CHECKIN_TIME / ZOHO_ATTENDANCE_CHECKOUT_TIME properties are
// not set. BOTH are required: Zoho computes worked hours from the pair, and a
// check-in with no check-out yields 0 hours, which the muster roll scores as
// Absent (observed on 2026-08-05 — the import succeeded but every day showed A).
const ZOHO_ATTENDANCE_DEFAULT_CHECKIN_TIME = "09:30:00";
const ZOHO_ATTENDANCE_DEFAULT_CHECKOUT_TIME = "18:30:00";
// Statuses NOT pushed to Zoho (compared lower-cased). Blank cells are already
// skipped separately; only "Pending" (unanswered prompt) is filtered here.
const ZOHO_ATTENDANCE_NON_PUSH_STATUSES = ["pending"];
// Candidate header names for an optional Zoho employee-id column in the Log.
// Matched case/space/punctuation-insensitively; when present, records use
// empId instead of emailId. Blank if absent -> falls back to emailId.
const ZOHO_ATTENDANCE_EMPID_COLUMNS = [
  "Zoho Emp ID",
  "Zoho Employee ID",
  "Employee ID",
  "Emp ID",
  "empId"
];

const EMPLOYEE_ID_COLUMN = "Employee ID";
// Candidate header names for the geographic punch site (e.g. Bengaluru).
// Read from the Log's own Location column; omitted from the record if blank.
const ZOHO_ATTENDANCE_SITE_COLUMNS = [
  "Location",
  "Site",
  "Office Location",
  "Work Location"
];
