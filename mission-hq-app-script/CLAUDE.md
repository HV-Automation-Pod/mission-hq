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
ZohoAttendance.js  Push MissionHQ attendance into Zoho People (bulk import)
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
- Submit button value carries the date, the trivia/fact index, and (newer
  messages only) URL-encoded identity metadata after a `|`:

```text
submit_location_${date}_${currentFact}|e=${email}&d=${department}&l=${location}
```

  Built in `SlackMessage.js` `collectEmployeeLocationMessage(...)`, which now takes
  `department` and `location` (read from the MissionHQ Log row in
  `ProcessData.js`). This is invisible metadata inside the button `value` only —
  it does not change any visible message block, so old already-sent messages
  still render and work.

- `Office-Client` from Slack is written to the sheet as:

```text
Office + Client
```

## Submit Flow Ownership (edge function vs Apps Script)

The interactive submit path is split so each responsibility has exactly one owner
(the July 2 2026 refactor, commit `446b71e`). No duplication between the two.

- Edge function (`index.ts`) owns, on Submit:
  - Slack signature verification + payload parsing.
  - `updateSlackMessage` — the `chat.update` confirmation ("Thank you for your
    update! We received your response *<label>* for <date>.", preserving the
    Fun Fact).
  - `updateSlackProfileStatus` — sets the Slack profile status (WFH / On Leave /
    etc. via `STATUS_CONFIG`). **Today-only**: it returns early when the prompt's
    date is not today's IST date, and it never overwrites an existing status.
  - Email resolution: prefers the email embedded in the button value
    (`parseSubmitMeta`); falls back to the `users.info` API (`resolveUserEmail`)
    for older messages that predate the embedded metadata.
  - Forwards a clean record to Apps Script:
    `{ email, date, status, department, location }`.
- Apps Script `doPost` (`Code.js`) is a thin sheet-writer: takes
  `{ email, date, status }` and writes one cell via `updateLocationByEmailID`.
  `department` / `location` are forwarded for later use but currently ignored by
  `doPost`.

### `isToday` message-update bug (fixed)

The July 2 refactor originally wrapped `updateSlackMessage` in an
`if (isToday)` guard, so answering a prompt on any day other than the prompt's
own date recorded the sheet but left the DM showing the Submit button. That
guard was removed: the confirmation text names the prompt's own date, so
updating older/backfilled prompts is safe. The **profile-status** today-only
check was intentionally kept (see above).

### One-time confirmation backfill (done, script removed)

A one-off `BackfillConfirmations.js` walked the "Messages TS" sheet, and for each
answered-but-still-showing-Submit DM (July 1 onward) updated it to the
confirmation. It has served its purpose and was deleted. If needed again: read
`Messages TS` (Email ID / Message Ts / Date), cross-check the response in
MissionHQ Log, fetch the DM via `conversations.history`, skip if it already
starts with "Thank you for your update", else `chat.update`. Needs bot scopes
`im:history` + `im:write`, and honor Slack `Retry-After` on 429s (batch history
once per channel, not per message).

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
ZOHOPEOPLE.attendance.ALL
```

`ZOHOPEOPLE.attendance.ALL` is required for the attendance check-in/check-out push API. After adding it, re-run `startZohoPeopleAuthorization()` (with admin consent) to mint a fresh refresh token that carries the new scope.

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
ZOHO_ATTENDANCE_CHECKIN_TIME
```

Useful functions:

```text
startZohoPeopleAuthorization()
testLogZohoPeopleLeaves()
syncTodayZohoPeopleLeaves()
syncZohoPeopleLeavesForDate(dateString)
```

## Employee Sync from Zoho Org Tree (`SyncEmployees.js`)

`syncEmployeesFromZohoOrgTree()` (menu: **Sync Employees from Zoho**) GETs the
org-tree endpoint and syncs employees into the MissionHQ Log sheet. Idempotent.

- Reads the endpoint URL from the `ZOHO_ORG_TREE_URL` Apps Script Property, with
  optional `ZOHO_ORG_TREE_TOKEN` sent as both `Authorization: Bearer` and
  `apikey` headers. Expects JSON `{ total_active, employees: [...] }` where each
  employee has `email`, `first_name`, `last_name`, `department`, `location`, etc.
- New employees (email not in the sheet) → appends a row with Full Name / Email
  Address / Department / **Location**.
- Existing employees → fills the **Location** cell only when it is currently
  blank (never overwrites a value already in the sheet). Batched single write.
- All columns are found by header name (`indexOf`), never by position.
- The `Location` filled here is the geographic site (Bengaluru, etc.) — the same
  column the Zoho attendance push reads for its punch site.

## Attendance Push to Zoho (MissionHQ -> Zoho)

Phase 1 of the reverse integration: pushes who was present each day into Zoho
People so attendance is reflected there. This is the opposite direction from the
leave sync (which reads Zoho). Long-term goal is real hours worked; phase 1 only
sends a nominal check-in.

Lives in `ZohoAttendance.js` and reuses the Zoho OAuth + domain-fallback helpers
from `ZohoPeople.js`. Requires the `ZOHOPEOPLE.attendance.ALL` scope.

API used (one request for the whole org):

```text
POST /people/api/attendance/bulkImport?data=<JSONArray>
dateFormat=yyyy-MM-dd HH:mm:ss
```

Each present employee becomes a check-in object, identified by `emailId` (or
`empId` if a Zoho emp-id column exists in the log sheet):

```json
[{"emailId":"a@hyperverge.co","checkIn":"2026-06-24 09:30:00","location":"Office"}]
```

- Bulk Import rate limit: 10 requests / 5-min lock. One call per day stays well
  under it. (The single check-in/check-out API is avoided because its 5-min lock
  is per-request and would not scale across the org.)
- Phase 1 sends **check-in only** (no check-out / hours). Check-in time is a
  nominal placeholder; override with the `ZOHO_ATTENDANCE_CHECKIN_TIME` property
  (`HH:mm:ss`, default `09:30:00`).

### Who gets pushed

Every real status is pushed. Only blank cells (no response) and `Pending` are
skipped (`ZOHO_ATTENDANCE_NON_PUSH_STATUSES`).

### Location label

Zoho's `location` means a geographic punch **site** (e.g. Bengaluru, Mumbai),
not a work mode like Home/Office. It is read from the MissionHQ Log's own
`Location` column (per-employee site). If that column is absent/blank, `location`
is omitted (it is optional in Zoho).

### Functions

```text
syncTodayAttendanceToZoho()
syncAttendanceToZohoForDate(dateString)
testLogZohoAttendancePayload()   // dry run: logs payload, calls nothing
```

Run manually from the **MissionHQ** spreadsheet menu first
(`Preview Attendance Push` then `Push Attendance to Zoho`); attach to a daily
end-of-day trigger once validated. Not wired into the prompt/reminder flow.

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
syncZohoAttendance
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
