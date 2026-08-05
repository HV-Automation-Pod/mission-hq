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
// Nominal check-in time (HH:mm:ss) used when no ZOHO_ATTENDANCE_CHECKIN_TIME
// property is set. Phase 1 sends check-in only (no check-out / hours).
const ZOHO_ATTENDANCE_DEFAULT_CHECKIN_TIME = "09:30:00";
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
