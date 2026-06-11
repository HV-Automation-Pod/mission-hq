# MissionHQ Apps Script Handoff

This folder contains the Google Apps Script backend and Supabase Edge Function for the MissionHQ attendance/location bot.

Do not store real Slack tokens, signing secrets, Supabase project refs, Apps Script deployment IDs, Zoho credentials, or shared secrets in this file. Use placeholders in docs and keep real values in Supabase secrets or Apps Script Properties.

## Current Flow

Slack interactions go through Supabase first:

```text
Slack interaction
  -> Supabase Edge Function
  -> immediate Slack response / message update
  -> background forward to Apps Script
  -> Google Sheet update / Slack profile update
```

This keeps Slack responses fast and avoids Slack's 3-second timeout.

## Supabase Edge Function

Function code:

```text
supabase/functions/mission-hq/index.ts
```

Config:

```text
supabase/config.toml
```

The function has `verify_jwt = false` because Slack does not send Supabase JWTs. Slack request authenticity is handled using Slack signature verification.

Deploy:

```bash
cd mission-hq-app-script
supabase functions deploy mission-hq --project-ref '<SUPABASE_PROJECT_REF>'
```

Required Supabase secrets:

```bash
supabase secrets set MISSION_HQ_SLACK_BOT_TOKEN='<SLACK_BOT_TOKEN>' --project-ref '<SUPABASE_PROJECT_REF>'
supabase secrets set MISSION_HQ_SLACK_SIGNING_SECRET='<SLACK_SIGNING_SECRET>' --project-ref '<SUPABASE_PROJECT_REF>'
supabase secrets set MISSION_HQ_APPS_SCRIPT_URL='<APPS_SCRIPT_WEB_APP_EXEC_URL>' --project-ref '<SUPABASE_PROJECT_REF>'
```

Optional shared secret:

```bash
supabase secrets set MISSION_HQ_APPS_SCRIPT_SHARED_SECRET='<SHARED_SECRET>' --project-ref '<SUPABASE_PROJECT_REF>'
```

If a secret changes, redeploy:

```bash
supabase functions deploy mission-hq --project-ref '<SUPABASE_PROJECT_REF>'
```

## Slack App Config

Interactivity & Shortcuts Request URL:

```text
<SUPABASE_FUNCTION_URL>/mission-hq
```

The Edge Function handles:

- Slack signature verification.
- Static select payloads with an immediate empty response.
- Submit button actions with fast Slack message update.
- Background forwarding of submit payloads to Apps Script.

## Apps Script Responsibilities

Apps Script still owns:

- Reading employee rows from the MissionHQ Google Sheet.
- Sending daily location prompts.
- Sending reminders to pending users.
- Writing location responses into the sheet.
- Updating Slack profile status.
- Syncing approved Zoho People leaves before prompts/reminders.
- Exposing dashboard data through `doGet` endpoints.

## Key Files

```text
Code.js            Slack constants, trivia/messages, doPost entrypoint
Constants.js       Zoho People constants and property names
Menu.js            Spreadsheet custom menu
ProcessData.js     Daily prompt/reminder flows
SlackMessage.js    Slack message block builders and send helpers
UpdateData.js      Slack payload handling and sheet/profile updates
ZohoPeople.js      Zoho People OAuth and leave sync
WebApp.js          doGet API for dashboard and leave sync endpoints
GetData.js         Sheet/user lookup helpers
Analytics.js       Analytics helpers
SlackData.js       Slack user/channel data sync
```

## Attendance Behavior

- `processEmailsAndSendSlackMessage()` syncs Zoho People leaves for today before sending prompts.
- Reminder flow also syncs Zoho People leaves before reminding pending users.
- Approved Zoho People leaves are marked as `Leave` in the sheet.
- People marked `Leave` are skipped by the prompt/reminder bot.
- Pending Zoho People leaves are logged in the test function but are not applied to attendance.
- All users now submit through the `submit_location_...` button path.
- Static dropdown changes intentionally return an empty response and wait for the user to click Submit.
- Submit button value includes the current trivia/fact index:

```text
submit_location_${date}_${currentFact}
```

- `Office-Client` from Slack is written to the sheet as:

```text
Office + Client
```

## Location Dropdown

The Google Sheet `Locations` tab should include:

```text
Display: Office + Client
Value: Office-Client
```

Slack payloads use `Office-Client`; Apps Script converts it to `Office + Client` for the sheet.

## Zoho People Integration

Zoho People API endpoint used:

```text
GET /api/v2/leavetracker/leaves/records
```

Base domain is configured through Apps Script Properties and defaults in code.

Request params:

```text
from
to
dateFormat=yyyy-MM-dd
approvalStatus=["APPROVED"]
dataSelect=ALL
startIndex
limit
```

Zoho People OAuth scopes:

```text
ZOHOPEOPLE.leave.READ
ZOHOPEOPLE.forms.READ
ZOHOPEOPLE.employee.ALL
```

Required Apps Script Properties:

```text
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
ZOHO_REFRESH_TOKEN
ZOHO_ACCESS_TOKEN
ZOHO_ACCESS_TOKEN_EXPIRES
```

Optional Apps Script Properties:

```text
ZOHO_PEOPLE_API_DOMAIN
ZOHO_PEOPLE_REDIRECT_URI
ZOHO_PEOPLE_ACCOUNTS_URL
```

Useful functions:

```text
startZohoPeopleAuthorization()
testLogZohoPeopleLeaves()
syncTodayZohoPeopleLeaves()
syncZohoPeopleLeavesForDate(dateString)
```

## Apps Script Deployment

Push Apps Script changes:

```bash
cd mission-hq-app-script
clasp push
```

List deployments:

```bash
clasp deployments
```

Test a web app URL:

```bash
curl -L -s -o /dev/null -w "%{http_code} %{url_effective}\n" '<APPS_SCRIPT_WEB_APP_EXEC_URL>'
```

## Required Slack / Apps Script Values

Real values should live outside this file.

Current code still reads global constants such as:

```text
SLACK_BOT_TOKEN
SLACK_USER_TOKEN
SLACK_CHANNEL_ID
REMINDER_CHANNEL_ID
ALERT_USER_ID
HYPERFIESTA_NOTION_URL
```

If hardcoded tokens exist in code, move them to Apps Script Properties before pushing to public/shared git.

## Dashboard Endpoints

`WebApp.js` exposes `doGet` actions used by the dashboard and admin/testing flows:

```text
all
today
daterange
departments
analytics
summary
zohoPeopleAuthUrl
syncZohoPeopleLeaves
```

## Validation

Syntax check:

```bash
cd mission-hq-app-script
for f in *.js; do node --check "$f"; done
```

Check for concrete secrets before pushing:

```bash
rg -n "xox[baprs]-|AKfyc|script\\.google\\.com|[a-f0-9]{32,}" .
```

Files/folders that should not be committed:

```text
supabase/.temp/
.clasp.json
```

Suggested gitignore entries:

```gitignore
**/supabase/.temp/
**/.clasp.json
```

## Troubleshooting

### Slack submit is slow or fails

Check that the Slack Interactivity Request URL points to the Supabase function, not directly to Apps Script.

### Supabase logs show Apps Script forward failed

Check:

- `MISSION_HQ_APPS_SCRIPT_URL` secret.
- Apps Script deployment URL.
- Apps Script web app access settings.

Then reset the secret and redeploy:

```bash
supabase secrets set MISSION_HQ_APPS_SCRIPT_URL='<APPS_SCRIPT_WEB_APP_EXEC_URL>' --project-ref '<SUPABASE_PROJECT_REF>'
supabase functions deploy mission-hq --project-ref '<SUPABASE_PROJECT_REF>'
```

### Supabase CLI asks for keychain password

This is macOS asking for the login keychain password for stored Supabase CLI credentials. Enter the Mac login password or run:

```bash
supabase login
```

### Docker warning during deploy

This warning can appear and deployment can still succeed:

```text
WARNING: Docker is not running
```
