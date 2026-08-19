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
WorkCalendar.js    Weekends + the company holiday list (also a shared library)
SlackMessage.js    Slack message block builders and send helpers
UpdateData.js      Slack payload handling and sheet/profile updates
ZohoPeople.js      Zoho People OAuth and leave sync
ZohoAttendance.js  Push MissionHQ attendance into Zoho People (bulk import)
MonthlySummary.js  Fortnightly per-group attendance summaries to Slack channels
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
- **Leave → sheet matching is by Employee ID, not email.** Zoho's leave records
  carry **no employee email** — only `EmployeeId` (the org-tree `emp_id`), a
  display `Employee` name, `ZUID`, and `Employee.ID`. They occasionally include
  `TeamEmailID`, which is the **reporting manager's** email — it must NOT be
  used as the employee (an earlier bug read it and marked the manager, e.g. sai,
  as `Leave`, silently suppressing their prompts). The sync joins each approved
  leave to the sheet by **`EmployeeId` → sheet Employee ID column**, falling back
  to normalized name for rows without an emp id. Both keys are normalized
  (lowercase / punctuation-insensitive; emp ids like `348C` compared
  case-insensitively). Unmatched leaves are logged (`no matching sheet row`) so
  nobody is silently skipped. The `Leave` write still won't overwrite a real
  submitted status — only blank/`Pending`. See
  [Employee Sync](#employee-sync-from-zoho-org-tree-syncemployeesjs) for how the
  Employee ID column is populated. Key functions in `ZohoPeople.js`:
  `getZohoPeopleLeaveIdentitiesForDate`, `buildSheetEmployeeLookups_`,
  `matchLeaveToSheet_`, `syncZohoPeopleLeavesForDate`.
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

## Slack User ID Cache (per-run efficiency)

The daily prompt and reminder flows used to call Slack `users.lookupByEmail`
once **per employee, every run** (and `collectEmployeeLocationMessage` re-read
the whole `Locations` sheet once per employee). Both are now hoisted/cached:

- `getLocationsList()` is called **once per run** in `ProcessData.js` and the
  result is passed into `collectEmployeeLocationMessage(..., locations)`. The
  function still falls back to `getLocationsList()` when no list is supplied
  (e.g. the `testCollectEmployeeLocationMessageToAlertUser` helper).
- A `Slack User ID` column (constant `SLACK_USER_ID_COLUMN`) in the MissionHQ
  Log caches each employee's resolved `U…` id. `getOrCreateColumnIndex_()`
  auto-creates it at the end of the sheet on first run (looked up by header
  name, never by position). Per row: if the id cell is filled it is used
  directly (no API call); if blank, `getUserInfoByEmail` resolves it once and
  the id is written back. After one backfill run, lookups drop to only
  newly-added employees.
- Store the **user id** (`U…`), not the DM channel id — `chat.postMessage`
  accepts a user id as `channel` and opens/reuses the DM itself.

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

## Daily Prompt Content: Messages & Trivia (with low-trivia alert)

The daily prompt DM (built in `SlackMessage.js` `collectEmployeeLocationMessage`)
is assembled from two rotating arrays in `Code.js`:

- `MESSAGES` — the greeting line (`{name}` is substituted). ~35 entries.
- `TRIVIA` — the "Fun Fact:" line. ~172 entries. Reviewed July 2026 for a 350+
  person, India/Vietnam-heavy org: US-only pop-culture and celebrity trivia and a
  few debunked "facts" were cut, and the list was reweighted toward India,
  Vietnam/Asia and universal science/nature. Each fact was verified against a
  reputable primary source (NASA, UNESCO, Guinness, Nature, PLoS, Britannica,
  NIST, etc.). Keep facts work-appropriate and globally neutral — the prompt DMs
  the whole org across Bengaluru, Mumbai and Vietnam.

Rotation is driven by two Script Properties, `currentStep` (into `MESSAGES`) and
`currentFact` (into `TRIVIA`), each advanced by 1 in `ProcessData.js` after a
successful daily send (`if (sentCount > 0)`), wrapping with `% length`. They only
advance on real send days, so weekends/holidays don't burn entries.

**Low-trivia alert:** in `processEmailsAndSendSlackMessage()`, when the fact
shown that day is one of the **last 3** (`currentFact >= TRIVIA.length - 3`), the
bot DMs `ALERT_USER_ID` (via `sendSlackConfirmationMessage`) that trivia is
almost out, with the count remaining. It fires on each of the final 3 days
(2 → 1 → 0 left) for buffer time, and is best-effort (try/catch, never blocks the
prompt). To refresh:

1. Replace/extend the `TRIVIA` array in `Code.js`.
2. If you replaced the list, reset the `currentFact` Script Property to `0` so
   the new facts play from the top (otherwise the old index points partway in).

Keep facts work-appropriate — the prompt DMs the whole org. This mirrors the
referral bot's motivational-sentence refill alert (`Slack.js` →
`REFERRAL_ALERT_USER_ID`) in the `hypertalent-platform/ta-scripts/referral` repo.

## Fortnightly Attendance Summaries (`MonthlySummary.js`)

Posts an attendance summary to five group Slack channels on the **1st and the
15th** of each month. Entirely separate from the daily prompt flow.

### Cadence and periods

Two monthly time-based triggers, both calling `sendScheduledSummaries()`:

```text
16th -> 1st-15th of the current month     (e.g. "1–15 August 2026")
1st  -> 16th-month end of last month      (e.g. "16–31 July 2026")
```

Two **non-overlapping halves**, each fully finished before it is reported.
Neither period includes the day the run happens on, so the trigger hour does not
affect the numbers, and deltas always compare a half-month against a half-month.

An earlier design ran on the 1st and 15th with the 1st reporting a whole month.
That was dropped: the halves overlapped (1–15 was counted twice), the two reports
covered unequal spans so per-person deltas were meaningless, and a 10 AM run on
the 15th would have counted that morning's still-`Pending` column against
everyone.

One handler covers both: `resolveSummaryPeriod_()` picks the half from the run
date (day >= 16 → `firstHalfPeriod_`, else `secondHalfPeriod_`). Month-end is
derived as day 0 of the following month, so 28/29/30/31-day months and year
rollovers are all handled.

Triggers are created by `createSummaryTriggers()` in the throwaway
`TempCreateTriggers.js` (1st and 16th at ~10 AM), or by hand in the Apps Script
triggers UI pointing at `sendScheduledSummaries`.

### Posting identity

Posts use the **HV Automation bot**, not the attendance bot —
`HV_AUTOMATION_BOT_TOKEN` script property. That bot holds
`chat:write.customize`, so each channel gets its own `username`
(e.g. `FLG Attendance`). Keep these names period-neutral — the 1st reports a
month and the 15th reports half a month, so "Fortnightly" or "Monthly" in the
name is wrong on one of the two runs. The payload deliberately sends **no**
`icon_url` / `icon_emoji`, so the profile image stays the bot's own everywhere —
only the display name varies per channel.

### Groups

Defined in `SUMMARY_GROUPS`. Column matchers split the cell on commas, so a
`Department` of `"Finance, FLG"` belongs to both FLG and G&A.

```text
FLG          roster tab "FLG" — hand-maintained email list (see below)
Mumbai       Location = Mumbai
Coimbatore   Location = Coimbatore
Bengaluru    Location = Bengaluru
G&A          Department in {People & Culture, Finance, Legal, Admin}
Managers     PMS Level matches M1 / M2 / M3 ... (see below)
```

Column matching is normalized (lower-cased, punctuation stripped), so
`People & Culture` == `people&culture`.

### FLG roster tab

FLG is **not a Zoho department** — its members sit across several departments, so
the Log's `Department` column (which tracks Zoho, see
[Employee Sync](#employee-sync-from-zoho-org-tree-syncemployeesjs) — a hand-typed
`FLG` there is overwritten on the next sync) can never name them. Membership is
maintained by hand on the **`FLG`** tab of the MissionHQ spreadsheet:

```text
Full Name | Email Address     <- header row; only the email column is read
```

`match: { type: "roster", sheet: "FLG" }` → `readRosterEmails_()` reads that
column (header found by candidate name, never by position — `Email Address` /
`Email ID` / `Email`), lower-cases and de-duplicates it, and the Log rows are
filtered to those emails. **Adding someone to FLG means adding a row here**;
nothing else picks them up.

Roster emails with no MissionHQ Log row are **logged by name** (`not found in
MissionHQ Log`) rather than silently dropped — check the execution log if a
group looks short. An empty or column-less roster tab throws, which skips only
the FLG post; the other groups still go out.

Why it changed: the 1–15 August 2026 FLG snapshot went out with **one person in
it**, because the Department matcher only ever found rows whose Zoho department
literally read `FLG`.

A throwaway `FixFlgSnapshot.js` rebuilt that fortnight from the roster and
`chat.update`d the message already in the channel — 24 ranked members, ts
`1786857318.521859`, corrected 2026-08-19. It has served its purpose and was
deleted. If a snapshot ever needs correcting again: rebuild via
`readMissionHqSnapshot_` → `resolveGroupMembers_` → `computeMemberMetrics_` →
`buildSnapshotMessage_` for a **pinned** period, find the message by its own
fallback text (`<Group> attendance — <label>`) through `conversations.history`,
and `chat.update` it with the summary bot's token. Reuse the group's snapshot
number rather than advancing it, and re-`saveScores_` afterwards so the next
delta baseline is the corrected one. The corrected message showed **no deltas**:
the bad send had overwritten July's baseline with its own period, and
`readPreviousScores_` will not diff a period against itself.

### PMS Level column and the Managers group

The Managers group reads the MissionHQ Log's own **`PMS Level`** column and takes
every row matching `/^m\d+$/` after normalizing — so `M1`, `M2`, `M12` are in,
while `IC 2`, `AM`, `NA` and blanks are out.

That column is populated from a **separate spreadsheet** (`PMS_MASTER_SHEET_ID`
property), tab `Master Sheet`, **headers in row 2**, column **`PMS '26 Level`**.
Note this is the **Level** column, *not* `PMS '26 Rating` — that one holds
"Consistently Meets" / "Often Exceeds" text and is only kept as a fallback
candidate.

The PMS sheet also holds compensation data, so it is read **once**, not on every
run:

- `syncPmsLevelsToLog()` (menu: **Sync PMS Levels**) reads only the email and
  level columns — never a whole row — and writes each level into the Log's
  `PMS Level` column, matched by email. All levels are copied (IC/AM too), not
  just manager ones.
- It also runs at the end of `syncEmployeesFromZohoOrgTree()`, so levels refresh
  on the same cadence as the employee sync and new hires get a level without a
  separate manual step. That call is best-effort — a PMS failure is logged and
  does not fail the employee sync.
- Rows whose email is absent from the PMS sheet are left untouched and counted
  in the log. A row present in PMS with a blank level is cleared, so a demotion
  out of M-level leaves no stale value.
- Scheduled runs read only the local column and never open the PMS sheet.
- Re-run the sync when levels change. If the column is missing, only the
  managers channel is skipped — the other four still post.

### Message structure and metrics

Built with **Slack Block Kit** (`buildSnapshotMessage_()` returns
`{ text, blocks }`; `text` is only the notification fallback). Layout:

```text
header      GROUP · Attendance Snapshot
context     period · working days · people · nth snapshot
section     True WFO Adherence + 10-cell bar + group movement vs last snapshot
fields      Check-in rate | Pending days | Meeting the standard | Days counted
section     Stack ranking, one code-block table per tier
section     Our ask (3 points)
context     methodology + sign-off, as small print
```

Two deliberate choices: the ranking tables are **code blocks** because that is
the only way Slack gives column alignment (emoji do not render inside, hence the
`▲ ▼ █ ░` text markers), and the methodology sits at the **bottom** as context —
it is reference material, not the headline, and it used to swamp the top of the
message.

`chunkRows_()` splits a tier's table when it would exceed a section's 3000-char
cap, so a large group cannot silently lose members.

Metric definitions — these are the established ones, do not "improve" them
casually:

```text
available   = working days − leave days     (leave fully excluded)
True WFO    = WFO days ÷ available days     (the ranking metric)
CI rate     = checked-in days ÷ available days
WFO quality = WFO days ÷ checked-in days
```

Status buckets (`classifyAttendanceStatus_`, matched normalized):

```text
WFO      Office, Client Location, Split Day, Travel, Anywhere, Office + Client
WFH      Home
LEAVE    Leave                       -> removed from the denominator entirely
PENDING  "Pending" AND blank cells    -> "pending = invisible"
```

A **blank cell counts as Pending**, deliberately: a day with no check-in cannot
be credited as presence. Note the side effect — someone who joined mid-period
has blanks for the days before they arrived and will score low. Watch for this
when a new hire's first snapshot looks bad.

Tiers, ranked by True WFO Adherence (CI rate breaks ties):

```text
S  >=90%   A  80-89%   B  60-79%   C  1-59%   D  0% (check-in not active)
```

Members with `available == 0` (on leave the whole period) are **not ranked** —
they are listed in a separate one-line note instead of being dumped into tier D
as if they had ignored the bot.

### Deltas and snapshot numbering (automatic)

Both used to be pasted in by hand. They are now per-group script properties,
written **only after a successful real send** — test and dry runs never touch
them, so previewing does not corrupt the next delta:

```text
SUMMARY_SCORES_<groupKey>     JSON { name: trueAdherence } from the last send
SUMMARY_SNAPSHOT_<groupKey>   integer, renders as "our fifth attendance snapshot"
```

A delta of ±10pp or more is bolded; ±15pp or more also gets an arrow. Members
are keyed by **Full Name**, so a renamed row loses its delta for one cycle.

### AI narrative (not wired up)

The manual version optionally passed the message through Claude for headline
insight and inline commentary on big movers. That is deliberately **not**
included — the template output is deterministic and reviewable. To add it later,
post-process the blocks from `buildSnapshotMessage_()` before
`postSummaryToSlack_()`.

### Auditing

`logDetailedAudit(groupKey)` (menu: **Audit Last Month**) logs every member's
day-by-day status and classification, plus the arithmetic behind their
percentages. Use it when someone challenges their numbers. Omit `groupKey` for
all groups.

### Functions

```text
sendScheduledSummaries()      // trigger handler, both days
sendScheduledSummariesNow()   // manual re-send of the current period, real channels
previewScheduledSummaries()   // logs only, posts nothing, writes no state
testFirstHalfSummaries()      // the 16th run (1st-15th), to the test channel, any day
testSecondHalfSummaries()     // the 1st run (16th-month end), to the test channel
logDetailedAudit(groupKey)    // day-by-day breakdown, logs only
syncPmsLevelsToLog()          // fills the Log's PMS Level column
```

The two test functions exist because each half is otherwise only reproducible on
its own trigger day. They post every group to `TEST_SUMMARY_CHANNEL_ID`, prefix
each message with the channel it *would* have gone to, and **write no state**, so
scores and snapshot numbers stay clean no matter how often they run.

Run `testFirstHalfSummaries()` before the 16th and it only has the date columns
that exist so far — the layout is right but the percentages are partial.

### Required script properties

```text
HV_AUTOMATION_BOT_TOKEN    HV Automation bot (chat:write + chat:write.customize)
TEST_SUMMARY_CHANNEL_ID    channel the test functions post to
PMS_MASTER_SHEET_ID        spreadsheet id of the PMS master sheet
```

These were set once via a throwaway `SetupSecrets.js` (gitignored, shipped
blank, validated the token against `auth.test`, then deleted). To change one,
edit it directly in Apps Script **Project Settings → Script Properties**.

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

Note: the leave record has **no employee email field** — join to the sheet by
`EmployeeId` (see [Attendance Behavior](#attendance-behavior)). Each record
carries `EmployeeId`, `Employee` (name), `ZUID`, `Employee.ID`, `From`, `To`,
`ApprovalStatus`, and a per-day `Days` map (some in-range days have
`LeaveCount: 0.0`, e.g. weekends — currently we use the `From`→`To` range, not
the `Days` map).

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
  employee has `email`, `first_name`, `last_name`, `department`, `location`,
  **`emp_id`**, etc. (`emp_id` values look like `551` or `348C` for contractors).
- New employees (email not in the sheet) → appends a row with Full Name / Email
  Address / **Slack User ID** / Department / **Location** / **Employee ID**. The
  Slack User ID is resolved once from the email via `getUserInfoByEmail` at sync
  time (best-effort — blank if the hire isn't in Slack yet; the daily flow fills
  it later). See [Slack User ID Cache](#slack-user-id-cache-per-run-efficiency).
- Existing employees:
  - **Location** — filled only when the cell is blank (never overwrites).
  - **Slack User ID** — filled only when blank (resolved via `getUserInfoByEmail`).
  - **Employee ID** — kept **in sync with Zoho**: overwritten whenever the
    org-tree `emp_id` differs from the sheet (not just when blank), because an
    id can change (e.g. contractor `348C` converting to full-time `348`). This is
    the deliberate exception to the fill-only-if-blank rule.
- The **Employee ID** column is the join key the leave sync uses (see
  [Attendance Behavior](#attendance-behavior)). Its header is looked up via
  `ZOHO_ATTENDANCE_EMPID_COLUMNS` candidates (`Zoho Emp ID`, `Employee ID`, …);
  if none exist it is created as `EMPLOYEE_ID_COLUMN` (`"Employee ID"`). The same
  column is what the Zoho attendance push reads for its `empId`.
- All columns are found by header name (`indexOf` / candidate match), never by
  position. Each touched column is written back in one batched `setValues`.
- The `Location` filled here is the geographic site (Bengaluru, etc.) — the same
  column the Zoho attendance push reads for its punch site.

## Work Calendar (`WorkCalendar.js`) — this project is a shared library

Weekends and the **company holiday list** live here, and this project is
published as an Apps Script library so the rest of the org reads the same list
instead of each automation keeping a copy:

```json
{ "userSymbol": "MissionHQ",
  "libraryId": "1rfcF-KeUDthKpZ2kmXkefHXa0fAYzWrOuO-tTAs702ZhUVpxPXICa-uH",
  "version": "0", "developmentMode": true }
```

| Exported | |
|---|---|
| `isWeekend([date])` | Saturday or Sunday; defaults to today, logs |
| `isHoliday([date])` | on the holiday list; defaults to today, logs |
| `isBusinessDay(date)` | neither — quiet, safe to call in a loop |
| `rollToBusinessDay(date)` | that day, or the next working one |
| `addBusinessDays(date, n)` | n working days later (start day not counted) |
| `getHolidays()` / `getHolidayYear()` | the raw `MM/DD` list and its vintage |

**The yearly refresh happens here and nowhere else.** Replace the array in
`hvHolidays_()` and bump `HV_HOLIDAY_YEAR`. Most Indian holidays move every
year, so a stale list is silently wrong — `hvWarnStaleHolidayList_()` logs a
warning once per execution when the calendar year has moved past
`HV_HOLIDAY_YEAR`.

Dependants run this project's **HEAD** (`version: "0"`, `developmentMode: true`),
so the refresh reaches them with no manifest change on their side. Note that
`version` and `developmentMode` are not independent knobs: `developmentMode:
false` means "use the version specified", so a pinned number and HEAD are the
only two options — there is no "always the latest released version" setting.

Cut a library version alongside the yearly edit, as a rollback point:

```
clasp create-version "Work calendar: <year> holidays"
```

| Version | |
|---|---|
| 47 | shared work calendar; 2026 holidays |

Nothing reads those numbers day to day. They exist so that when a bad push here
breaks a dependant, that one project can be dropped onto known-good code
(`"version": "47", "developmentMode": false`) while HEAD gets fixed.

Current dependants: `hv-automations/dinner-poll-automation`,
`hv-automations/pnc-automation/pofu-automation`.

Inside this project just call `isWeekend()` / `isHoliday()` directly — they used
to live in `ProcessData.js` and the call sites there are unchanged.

## POFU Sheet Sync (`PofuSync.js`)

Mirrors the org-tree employees into a **second, separate spreadsheet** — the
POFU HyperVerge sheet (`POFU_SPREADSHEET_ID`), tab **`POFU Automation`** — so the
onboarding check-in automation (48 hour / 30 day / 90 day messages) has a
machine-written roster. That automation lives in the POFU sheet's own Apps
Script project, not here; this repo only keeps the roster fed.

**It never calls Zoho.** `syncEmployeesToPofuSheet(employees)` takes the array
`fetchZohoOrgTreeEmployees_()` already returned and is invoked from inside
`syncEmployeesFromZohoOrgTree()` — one org-tree request feeds both sheets. Do
not add a second fetch here.

The call sits **before** the MissionHQ Log write and is wrapped in try/catch, so
a POFU failure never fails the employee sync, and a Log-side failure (missing
column, etc.) does not block POFU either.

### Columns

Created on first run; a sheet that already exists gets only its **missing**
headers appended at the end, so a hand-arranged tab is never reshuffled.

```text
Employee Name      from first_name + last_name
Employee ID        org-tree emp_id
Employee Email     the match key
Date of Joining    see below
48 Hour Message    created, never written by this sync
30 Day Message     created, never written by this sync
90 Day Message     created, never written by this sync
```

Headers are matched by candidate list (case/punctuation-insensitive, via
`findColumnIndexByCandidates_`), so an existing `Full Name` or `Email Address`
column is reused instead of a near-duplicate being appended beside it.

### Write rules

Rows are matched by **email**, lower-cased. New emails are appended.

```text
Employee Name      filled only when blank
Employee ID        tracks Zoho — overwritten whenever it differs
Date of Joining    filled only when blank (a hand-corrected date survives)
the 3 message columns   never touched, ever — the POFU automation owns them
```

### Date of Joining

Read straight from the org-tree `date_of_joining` field, which arrives as
`"10-Aug-2026"` and is normalized to `yyyy-MM-dd` by `formatPofuDate_()`. An
unparseable value is written through as-is rather than dropped; a blank one
leaves the cell empty and is counted in the log — **those employees' 48h/30d/90d
triggers cannot fire until the date is filled**, in Zoho or by hand.

The org-tree payload carries far more than this sync uses — `designation`,
`employment_type`, `business_unit`, `reporting_manager_email`, `date_of_exit`,
`onboarding_status`, plus personal data (DOB, addresses, PAN, Aadhaar, personal
email/mobile). **Do not widen the POFU columns into the personal fields**; the
POFU sheet is shared more broadly than the HRIS.

`date_of_exit` and `onboarding_status` are the useful ones if this ever needs to
stop tracking leavers or gate on onboarding state.

### Scope

**All active employees** are synced, not just recent hires — so on first run the
tab fills with the whole org, and the trigger automation is responsible for
ignoring anyone whose 48h/30d/90d window has already passed.

### Formatting (`formatPofuSheet_`)

Runs at the end of every sync, wrapped in try/catch — the roster matters, the
paint job does not. Idempotent: banding is **replaced**, not stacked, so a year
of daily runs leaves exactly one of it.

```text
header      dark slate, white bold, frozen, 34px
data        banded rows, per-column widths, middle-aligned, thin borders
sort        newest joiner first (whole row width, so extra columns travel along)
Employee ID number format "@" — stops "551" and "INT390" aligning differently
filter      basic filter, created once and left alone unless the data outgrows it
```

**Layout only — no conditional formatting.** An earlier version painted the
message columns green/amber/grey by due date and added a legend note to each
header; it was removed as noise. Do not add it back without being asked. The
sheet's own conditional rules belong to whoever set them and are never read,
written or cleared here.

The joining date is stored as a **real Date** (`parsePofuDate_`), number format
`yyyy-mm-dd`, so it sorts chronologically and the conditional formulas can do
`TODAY()>=$D2+30` arithmetic. Dates are built from parts rather than
`new Date("2026-08-10")`, which parses as UTC and slips a day. Text dates left
over from earlier runs are converted in place on the next format pass.

Trailing empty columns are deleted and rows trimmed to the data plus a 10-row
pad, so the sync guards the grid with `insertColumnsAfter` / `insertRowsAfter`
before writing.

### Functions

```text
syncEmployeesToPofuSheet(employees)  // the sync; called by the employee sync
```

There is deliberately **no** standalone menu entry or "sync POFU only" wrapper —
that would mean a second org-tree fetch. Re-run **Sync Employees from Zoho**
instead; it is idempotent and feeds both sheets from the one request.

The Apps Script project must have edit access to the POFU spreadsheet — the
first run will prompt for the extra Drive/Sheets authorization scope.

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
- Each record sends **both check-in and check-out** (nominal `09:30:00` and
  `18:30:00`; override with `ZOHO_ATTENDANCE_CHECKIN_TIME` /
  `ZOHO_ATTENDANCE_CHECKOUT_TIME`). These are placeholders, not real hours.

  **Check-out is not optional.** The first version sent check-in only. Zoho
  accepted it — `{"response":"success"}` for all 237 records — but derives
  worked hours from the check-in/check-out pair, so every day landed at 0 hours
  and the **Muster roll showed `A` (Absent)** for people who were in the office,
  with `Worked Days (Present + On Duty)` = 0 across the board. An API success on
  this endpoint does not mean the day counts as present; verify in
  `Attendance → Organization Reports → Muster roll`, not just in the logs.

### Who gets pushed

Every real status is pushed. Only blank cells (no response) and `Pending` are
skipped (`ZOHO_ATTENDANCE_NON_PUSH_STATUSES`).

### Location label

Zoho's `location` means a geographic punch **site** (e.g. Bengaluru, Mumbai),
not a work mode like Home/Office. It is read from the MissionHQ Log's own
`Location` column (per-employee site). If that column is absent/blank, `location`
is omitted (it is optional in Zoho).

### Pushes YESTERDAY, not today

`syncYesterdayAttendanceToZoho()` is the entry point. Today's data is
half-finished when any sensible trigger would run — most rows are still
`Pending` — so the push targets the previous day. A missing date column
(weekend, holiday, no prompts) is a normal no-op, not an error.

### empId is required; emailId does not work

Records identify the employee by `empId` when the Log's Employee ID cell is
filled, and fall back to `emailId` when it is blank. **The emailId fallback is
rejected by Zoho.** Any array containing an emailId record 400s with a generic
code 7200 "API invocation failed" that names no field — so a single bad record
takes down every record batched with it.

Established by probe on 2026-08-05: 50 mixed records failed; the same 50 minus
the one emailId row passed; that row then failed alone in a batch of one. Batch
size was never the issue (50 empId records pass fine).

So `pushZohoAttendanceBulkImport_()` **groups records by identifier type** and
sends each group separately. An empId batch failure stops the run; an emailId
failure is logged with the affected people and the run continues. The real fix
for those rows is filling their Employee ID — run **Sync Employees from Zoho**,
and if that does not populate it, the employee has no `emp_id` in Zoho.

### Batching

Records go in batches of `ZOHO_ATTENDANCE_BATCH_SIZE` (default 50) with a 2s
pause, staying inside the 10-requests-per-5-minute lock. Do not drop the batch
size below 25 — a full org day needs ~5 requests at 50, and 10 at 25 already
sits on the rate-limit ceiling.

### Functions

```text
syncYesterdayAttendanceToZoho()         // the entry point
syncAttendanceToZohoForDate(dateString)
testLogZohoAttendancePayload()          // dry run: logs who + payload, calls nothing
diagnoseZohoAttendancePush()            // 6 probes separating size / location / identifier
```

Every push logs each record as
`row 3 · <Full Name> · <email> · empId <id> · Office · Bengaluru`
plus a tally by status and by identifier type, so a run can be checked against
the sheet without decoding bare empIds.

Note that `diagnoseZohoAttendancePush()` **really writes** check-ins for the
probes that pass — it is not a dry run.

Run manually from the **MissionHQ** spreadsheet menu first
(`Preview Attendance Push` then `Push Attendance to Zoho (Yesterday)`); attach to
a daily morning trigger once validated. Not wired into the prompt/reminder flow.

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
