# MissionHQ Dashboard

Location tracking dashboard for monitoring team work locations and office compliance.

## What it does

- Tracks daily work location of employees (Office, Home, Client Location, Split Day, Travel, Leave)
- Monitors **4-day office compliance** requirement per week
- Provides team-wise and individual breakdowns
- Dark/light theme support

## Features

### Overview Tab
- Today's stats cards with response rate indicator
- Daily attendance stacked bar chart (last 20 days)
- Status distribution pie chart
- Team-wise office percentage comparison

### Compliance Tab
- 4-day office compliance tracker per employee
- Compliant / At Risk / Non-Compliant categorization
- Weekly office attendance trend line chart

### Team View Tab
- Last 5 days status table per employee
- Employee detail cards with compliance progress bars
- Click any employee for detailed modal with:
  - 30-day activity heatmap
  - Weekly compliance breakdown
  - Status count summary

### Trends Tab
- Daily attendance stacked chart
- Weekly office % trend
- Team comparison chart

### Other
- Search by name or email
- Filter by team and date
- CSV export
- Responsive design

## Tech Stack

- **Next.js 14** with App Router
- **TypeScript**
- **Tailwind CSS**
- **Recharts** for charts
- **date-fns** for date utilities
- **Lucide React** for icons

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Data Source

Currently uses dummy data for demo. To connect to real data:

1. Deploy the `doGet` endpoint in Google Apps Script (`App Script/WebApp.js`)
2. Replace the dummy data import in `src/app/page.tsx` with a fetch call to your deployed web app URL

### Google Apps Script Setup

Add these as **Script Properties** (Project Settings > Script Properties):

| Key | Value |
|-----|-------|
| `SLACK_BOT_TOKEN` | Your Slack bot token (`xoxb-...`) |
| `SLACK_USER_TOKEN` | Your Slack user token (`xoxp-...`) |
| `SLACK_CHANNEL_ID` | Your Slack channel ID |

### API Endpoints (doGet)

| Parameter | Description |
|-----------|-------------|
| `?action=all` | All employee data with date-wise statuses |
| `?action=analytics` | Aggregated analytics |
| `?action=today` | Today's status for everyone |
| `?action=daterange&from=YYYY-MM-DD&to=YYYY-MM-DD` | Date range query |
| `?action=teams` | Team-grouped data |

## Deployment

```bash
npm run build
```

Deploy to Vercel, Netlify, or any Node.js hosting.
