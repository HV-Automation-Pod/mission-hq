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

const ZOHO_PEOPLE_SCOPES = [
  "ZOHOPEOPLE.leave.READ",
  "ZOHOPEOPLE.forms.READ",
  "ZOHOPEOPLE.employee.ALL"
];
