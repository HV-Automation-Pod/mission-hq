# MissionHQ Dashboard

Attendance and work-location dashboard for HyperVerge. Reads the `"mission-hq"`
schema in Postgres directly; the Slack bot and the scheduled jobs that fill it
live in `supabase/` at the repo root.

## What it does

- Tracks daily work location (Office, Home, Client Location, Split Day, Travel,
  Leave, Anywhere, Compensatory WFH, the two half-day statuses)
- Reports adherence to the office standard, per person and per department
- Gives PnC an admin surface for the controls that drive the bot: WFO exemption,
  prompt opt-in, location override, rosters, dashboard access, manual job runs
- Dark/light theme, CSV export, command palette

**The compliance rule is not "4 office days a week".** It is
`adherent / available`, where adherent = office days + WFH that fell on a
**Wednesday**, and available = prompted - leave - WFA within the annual cap.
`src/lib/policy.ts` is a deliberate mirror of the SQL function
`member_metrics()`; a change to either has to land in both.

## Tabs

| Tab | |
|---|---|
| Overview | today's snapshot, week trend, status split, streaks, weekly office check, department comparison |
| Compliance | weekly office check, historical compliance over a date range, office-percentage trend |
| Departments | department-grouped status table, employee detail modal with heatmap |
| Trends | daily stacked chart, weekly office percentage, department comparison |
| Admin | admins only; everything PnC used to do by hand |

## Access

Two roles. Anybody with a `hyperverge.co` Google account is a **member** and
sees their own attendance only. A row in `dashboard_access` makes somebody an
**admin**, who sees everyone and may edit if `can_edit` is set.

Scoping is enforced in SQL, by passing the viewer's email into
`dashboard_payload(p_email)` - a member's request never loads anybody else's
attendance into the process. The middleware only decides whether somebody is
signed in; `getViewer()` decides what they are allowed to see.

## Tech

Next.js 16 (App Router, Turbopack), TypeScript, Tailwind, Recharts,
`@supabase/ssr` for auth, Lucide icons.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npx tsc --noEmit -p . # must be clean before deploying
```

Three environment variables are required, and without them every route returns
500 rather than only the ones needing data:

| Variable | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | middleware, session, db |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | middleware and the browser auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only, never `NEXT_PUBLIC_` |

## Deployment

The Vercel project is **`mission-hq`**, and it is deployed **from the repo
root**, not from this folder - the project's Root Directory setting is already
`mission-hq`. See the Deployment section of `CLAUDE.md`, where every trap in
that sentence is written down with the outage it caused.

```bash
cd <repo root> && vercel deploy --prod --yes
```
