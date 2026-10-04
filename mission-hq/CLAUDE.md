# MissionHQ Dashboard

## Project Overview

MissionHQ is an employee location/attendance tracking system for HyperVerge.

**It runs on Supabase now.** The Google Sheet and the Apps Script that drove it
have been replaced by Postgres, pg_cron and Edge Functions in the **WeCare**
project (`jsehiivvzalvcrlybmlf`, schema `"mission-hq"`, quoted — the hyphen is
not optional).

1. **`supabase/migrations/`** — the schema. 44 migrations.
2. **`supabase/functions/`** — 9 Edge Functions. Eight are scheduled by pg_cron;
   `mission-hq` is the Slack webhook.
3. **`mission-hq/`** — Next.js 16 dashboard (TypeScript, Tailwind, Recharts),
   with authentication and an admin surface.
4. **`mission-hq-app-script/`** — LEGACY. Two functions still live here
   (`syncEmployeesFromZohoOrgTree`, `syncYesterdayAttendanceToZoho`), and the
   project must stay alive because `WorkCalendar.js` is published as a library
   that two other repos read at HEAD. **Everything below describing Apps Script
   as the backend is historical.** Do not apply it to new work.

## Architecture

### Apps Script (`mission-hq-app-script/`)

| File | Purpose |
|------|---------|
| `Code.js` | Constants (tokens, channel ID, messages, trivia), `doPost` handler, `logToDumpSheet` |
| `WebApp.js` | `doGet` API — endpoints: `all`, `today`, `daterange`, `departments`, `analytics`, `summary` |
| `GetData.js` | Reads Locations sheet, Slack `users.lookupByEmail`, `getValueByLocation` |
| `ProcessData.js` | Main daily flow: `processEmailsAndSendSlackMessage`, `processPendingEmailsAndSendSlackReminder`, `isWeekend`, `isHoliday`, `updateMissionHQLogFromSlackUsers` |
| `UpdateData.js` | Writes location responses, `updateSlackProfileStatus`, `handleLocationsPayload`, `updateSlackMessage`, `updateNamesFromSlack` |
| `SlackMessage.js` | `collectEmployeeLocationMessage`, `deleteSlackMessage`, `sendSlackConfirmationMessage` |
| `SlackData.js` | Fetches Slack channel members into "Slack Users" sheet |
| `Analytics.js` | `calculateUserStatusCounts`, `updateAnalyticsSheet`, `countValueInEmailRow` |
| `Delete.js` | Bulk deletes Slack messages from "Message Ts" sheet |
| `GetAllUsers.js` | Fetches all Slack workspace users into "Users" sheet |
| `Structured.js` | Fetches Slack thread conversations |
| `Test.js` | Test fixture for payload parsing |

### Google Sheets Structure

- **MissionHQ Log** — Main sheet. Columns: Full Name, Email Address, Department, Date, then date columns (YYYY-MM-DD) with statuses
- **Locations** — Dropdown options with "Locations" and "Value" columns
- **Messages TS** — Tracks sent message timestamps for deletion
- **Slack Users** — Channel member list
- **Analytics** — Aggregated status counts per employee
- **DUMP** — Debug logging

### Department Format

Departments are **comma-separated** in the sheet (e.g. "People & Culture, FLG", "Co-Founder, FLG", "FLG"). Both the Apps Script and dashboard parse these into individual departments for filtering and grouping.

### Slack App

- **Name**: HV Attendance Bot
- **Interactivity URL**: Google Apps Script web app deployment URL
- Bot sends DMs with location dropdown (static_select), user selects, `doPost` handles the response
- Bot also sets user Slack profile status (WFH, On Leave, etc.) using user token
- `messages_tab_enabled: true` is REQUIRED for DMs to work

### Required Slack Scopes

**Bot**: `channels:history`, `channels:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `users.profile:read`, `users:read`, `users:read.email`

**User**: `users.profile:read`, `users.profile:write`, `users:read`, `users:read.email`

### Dashboard (`mission-hq/`)

Next.js 16 app with Turbopack. Key files:

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main dashboard — tabs: Overview, Compliance, Departments, Trends |
| `src/app/api/data/route.ts` | API proxy to Apps Script |
| `src/lib/types.ts` | Types: `Employee` (has `departments: string[]`), `EmployeeAnalytics`, `WeekCompliance` |
| `src/lib/api.ts` | `fetchAllData()` — fetches and populates `departments` array |
| `src/lib/utils.ts` | `computeEmployeeAnalytics`, `calculateWeeklyCompliance`, streak calculations |
| `src/lib/theme.ts` | Dark/light theme provider |
| `src/components/StatsCards.tsx` | Today's snapshot — stat cards + KPI rings (Office, Responded, Pending) |
| `src/components/Filters.tsx` | Department dropdown, search, date picker |
| `src/components/Charts.tsx` | `DailyTrendChart` (week view with This/Last Week tabs, holidays marked), `StatusPieChart`, `TeamComplianceChart`, `WeeklyOfficeTrend` |
| `src/components/WeeklyOfficeCompliance.tsx` | Weekly 4-day office check — This/Last Week, shows who met 4-day requirement |
| `src/components/ComplianceTracker.tsx` | Overall compliance — date range, office days/total, compliant weeks/total, rate |
| `src/components/TeamBreakdown.tsx` | Department-grouped employee status table with date pagination |
| `src/components/EmployeeDetail.tsx` | Employee modal — compliance, streaks, status breakdown, heatmap |
| `src/components/StatusBadge.tsx` | Status display component |

### Dashboard Overview Tab Layout (top to bottom)

1. StatsCards (Today's Snapshot + KPI rings: Office, Responded, Pending)
2. DailyTrendChart + StatusPieChart (side by side, week view with holiday markers)
3. Streaks (Top 5 — Overall/Office tabs)
4. WeeklyOfficeCompliance (4-day office check — This/Last Week)
5. TeamComplianceChart (Department office attendance bar chart)

### Dashboard Compliance Tab Layout

1. WeeklyOfficeCompliance (4-day office check)
2. ComplianceTracker (Overall historical compliance with date range, weeks met, rate)
3. WeeklyOfficeTrend (Area chart)

## Holidays (2026)

Both Apps Script and dashboard use year-specific holiday dates:

```
2026-04-03, 2026-05-01, 2026-08-15, 2026-10-02,
2026-11-01, 2026-11-09, 2026-11-10, 2026-12-25
```

Holidays are:
- Skipped by `processEmailsAndSendSlackMessage` and reminder functions (no messages sent)
- Shown as amber "Holiday" bars in the DailyTrendChart
- Excluded from working day counts in WeeklyOfficeCompliance

## Key Concepts

- **The compliance rule is NOT "4 office days a week".** It is
  `adherent / available`, where adherent = office days + WFH that fell on a
  **Wednesday**, and available = prompted - leave - WFA within the annual cap.
  Wednesday is the default WFH day, so four office days plus a Wednesday at home
  is **100%, not 80%**. `src/lib/policy.ts` is a deliberate mirror of the SQL
  function `member_metrics()`; a change to either must land in both.
- **Three attendance states, not two.** No row = nobody asked (leaves the
  denominator). `'Pending'` = asked and ignored (stays in it). A status =
  answered. Conflating the first two is the bug that has done the most damage
  here.
- **Statuses**: Office, Home, Client Location, Split Day, Travel, Leave,
  Anywhere, Compensatory WFH, Office + Client, Half Day Office Leave, Half Day
  WFH Leave, Pending. Weights live in the `locations` table and every status's
  weights sum to 1, so counters are fractional.
- **Daily flow (IST)**: 08:30 directory sync, 08:50 Zoho leave, 09:00 prompts,
  10:00 verification, 13:50 leave again, 14:00 reminders, 19:30 Zoho push.
  Monday to Friday. The summary runs daily at 10:10 and only acts on the 1st
  and the 16th.

## Known Issues / Notes

**Current (Supabase):**

- `DAY_WEIGHTS` in `src/lib/policy.ts` is a hardcoded copy of the `locations`
  table. Correct today; it drifts the day somebody adds a status.
- A prompt whose row was written but whose DM failed is invisible to the
  verifier, so "re-running the prompt picks them up" is not true for that
  cohort.
- The eight scheduled functions gate on `settings.edge_invoke_key`, a random
  token. `verify_jwt` is off for all of them on purpose: it only asks "is this
  a JWT this project signed", and the anon key is one, so it admits the public.
- A scheduled job showing `active` in `cron.job` proves nothing. `cron.job`
  says what is scheduled; `cron.job_run_details` says what happened, and the
  two disagreed for the entire life of a dead cron cycle.

**Legacy (Apps Script, historical):**

- Hardcoded Slack tokens in `Code.js` and `Structured.js`
- `doPost` has no Slack request signature verification
- Web app access is `ANYONE_ANONYMOUS` with no auth

## Deployment — every one of these cost a real outage

**The Vercel project is `mission-hq`, NOT `mission-hq-dashboard`.**
It lives under the `satishb0369s-projects` scope and it owns the production
domain `mission-hq-dashboard.vercel.app`. The name mismatch is the trap: there
are two other projects called `mission-hq-dashboard` (one under
`hyperverge-academy`, one created by accident in the personal scope) and
NEITHER serves the live site. Environment variables were once added to the
wrong one of those and nothing changed, because the wrong project has no
traffic. **Confirm by the domain, not the name:**

```bash
vercel link --yes --project mission-hq     # from the REPO ROOT, see below
vercel domains ls                          # must list mission-hq-dashboard.vercel.app
```

**`vercel link --yes` CREATES a project when the name is not found in scope.**
It does not fail. That is how the stray empty project came to exist. If a link
succeeds but `vercel domains ls` and `vercel ls` are both empty, you are linked
to something new rather than to the real thing.

**Deploy from the REPO ROOT, not from `mission-hq/`.** The project's Root
Directory setting is `mission-hq`, so Vercel appends it to wherever you deploy
from. Running `vercel deploy` inside `mission-hq/` makes it look for
`mission-hq/mission-hq` and fail with "The specified Root Directory does not
exist".

```bash
cd <repo root> && vercel deploy --prod --yes
```

**The three required environment variables.** Without them the middleware
throws on its non-null assertions and EVERY route returns 500
`MIDDLEWARE_INVOCATION_FAILED` — not just the ones needing data.

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | middleware, session, db |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | middleware and the browser auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only, never `NEXT_PUBLIC_` |

**A `NEXT_PUBLIC_*` variable cannot be stored as a Secret.** It has to be
inlined at build time, and Vercel defaults anything credential-shaped to
Secret, so `vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY` fails with no useful
message. Pass `--no-sensitive` to force it to Config:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production \
  --value "$VALUE" --no-sensitive --force
```

**Merging is not deploying, and deploying is not working.** Verify against the
live URL every time. A signed-out request must never return data:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://mission-hq-dashboard.vercel.app/api/data
# 307 (redirect to /login) = correct. 200 = a live disclosure. 500 = env vars missing.
```

## Build & Run

```bash
cd mission-hq
npm run dev    # Development
npx next build # Production build
```

Environment variables are in `.env` file.
