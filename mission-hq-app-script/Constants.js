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

// Attendance push (MissionHQ -> Zoho). Bulk Import API is used so the whole
// org is sent in a single request (rate limit: 10 req / 5-min lock).
const ZOHO_PEOPLE_ATTENDANCE_BULK_PATHS = [
  "/people/api/attendance/bulkImport"
];

// Zoho Bulk Import expects this date-time format (note: different from the
// leave API's yyyy-MM-dd). checkIn/checkOut timestamps must match it.
const ZOHO_ATTENDANCE_DATETIME_FORMAT = "yyyy-MM-dd HH:mm:ss";

// Phase 1 sends a nominal check-in time only (no check-out / real hours yet).
// Override via the ZOHO_ATTENDANCE_CHECKIN_TIME script property ("HH:mm:ss").
const ZOHO_ATTENDANCE_DEFAULT_CHECKIN_TIME = "09:30:00";

// Optional log-sheet column holding each person's Zoho employee id. When
// present we send empId; otherwise we fall back to emailId (both are accepted
// by Zoho as the employee mapper). Header is matched case-insensitively.
const ZOHO_ATTENDANCE_EMPID_COLUMNS = ["Zoho EmpID", "Zoho Emp ID", "Employee ID", "EmpID"];

// MissionHQ Log column holding each employee's geographic site (e.g. Bengaluru).
// Zoho's "location" means a punch site, not a work mode, so this column feeds it
// directly. Matched case-insensitively; if absent, location is omitted.
const ZOHO_ATTENDANCE_SITE_COLUMNS = ["Location", "Site", "City"];

// Date-cell values that are not real attendance and are never pushed.
const ZOHO_ATTENDANCE_NON_PUSH_STATUSES = ["pending"];

const ZOHO_PEOPLE_SCOPES = [
  // Leave sync (existing): read approved leave records
  "ZOHOPEOPLE.leave.READ",
  "ZOHOPEOPLE.forms.READ",
  "ZOHOPEOPLE.employee.ALL",
  // Attendance push (new): check-in/check-out API write + read back
  "ZOHOPEOPLE.attendance.ALL"
];
