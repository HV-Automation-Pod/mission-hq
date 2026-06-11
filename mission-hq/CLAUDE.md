# MissionHQ Dashboard

## Project Overview

MissionHQ is an employee location/attendance tracking system for HyperVerge. It has two parts:

1. **`mission-hq-app-script/`** — Google Apps Script backend (deployed as web app)
2. **`mission-hq/`** — Next.js 16 dashboard frontend (TypeScript, Tailwind CSS, Recharts)

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
| `Notion.js` | Sends Hyperfiesta Notion reminder to Slack channel |
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

- **4-Day Office Compliance**: Employees should work from office 4 days/week. "Office" includes Office + Client Location + Split Day statuses.
- **Statuses**: Office, Home, Client Location, Split Day, Travel, Leave, Pending
- **Daily Flow**: Morning trigger sends Slack DM with location dropdown → user selects → `doPost` updates sheet + Slack profile status → reminder sent to Pending users later
- **`updateNamesFromSlack()`** in `UpdateData.js:385` — fills in missing Full Name column using Slack API for rows that have email but no name

## Known Issues / Notes

- Hardcoded Slack tokens in `Code.js` and `Structured.js` — should be moved to Script Properties
- `doPost` has no Slack request signature verification
- Web app access is `ANYONE_ANONYMOUS` with no auth
- `getUserData()` returns string `'Unknown'` on failure instead of null (inconsistent)
- Sheet name mismatch: `Delete.js` uses "Message Ts", `SlackMessage.js`/`UpdateData.js` use "Messages TS"
- `processMessagesdaraboina()` in `SlackMessage.js` is a dev artifact function name
- `Structured.js` uses a different Slack token than the rest of the codebase

## Build & Run

```bash
cd mission-hq
npm run dev    # Development
npx next build # Production build
```

Environment variables are in `.env` file.
