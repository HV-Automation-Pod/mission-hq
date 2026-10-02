# MissionHQ: Google Sheets → Supabase

Living runbook. Updated as the migration proceeds — if something here disagrees
with the code, the code is right and this file is stale; fix it.

**Last updated:** 2026-10-03

---

## The end goal

Everything MissionHQ does runs on Supabase — Postgres for the data, edge
functions for the logic, `pg_cron` for the schedule — with a dashboard where the
spreadsheet used to be. No Apps Script, no `MissionHQ Log` sheet.

## Why

Not because sheets are unfashionable. Because every recurring failure traced
back to the storage:

| Symptom | Root cause |
|---|---|
| `rollingMissedResponseSweep` timing out at row 283/375 | every job read a 376 × 346 grid; Apps Script caps an execution at 6 min |
| `WRITTEN_TO_DUPLICATE_COLUMN` | two columns for one date were *expressible* |
| answers lost after "Thank you for your update!" | write path was Slack → edge → **HTTP** → Apps Script → cell |
| Anuja / Gayathri / Harshit marked as leavers while employed | identity was an email string, matched one way, with no fallback |

`primary key (email, day)` makes the duplicate unrepresentable and turns "who is
pending today" into an index lookup. The rest follows from that.

---

## Where it lives, and why there

**Project: WeCare** (ref in Supabase; org Compass, PRO) — *not* Automations.

Postgres cannot join across projects, and WeCare already maintains, daily and in
production, the three hardest inputs:

| Reused from `public` | Refreshed | Replaces |
|---|---|---|
| `employees` — 351 from the Zoho org tree | 06:30 daily | `syncEmployeesFromZohoOrgTree` |
| `identity_links` — `slack_user_id` ↔ email | 02:00 daily | the sheet's `Slack User ID` column |
| `holidays` — date → name, with an admin screen | weekly | `WorkCalendar.js`'s hand-edited array |
| `pg_cron` + `pg_net`, 9 jobs already running | — | all 8 Apps Script triggers |

MissionHQ owns the `mission-hq` schema and writes nothing to `public`. The one
exception is a trigger **on** `public.employees` — see below.

**Accepted trade-offs**, knowingly:
- Anyone holding WeCare's service-role key can read attendance (service role
  bypasses RLS by design).
- A destructive migration by the WeCare team lands on MissionHQ's data too.
- Splitting out later is `pg_dump -n 'mission-hq'` plus re-pointing functions —
  hours, not a rewrite. That's why starting here is the cheap direction.

---

## Schema

```
mission-hq.employees    email pk, mirrored Zoho fields, exited_at,
                        wfo_exempt, prompt_opt_in, notes
mission-hq.attendance    (email, day) pk, status, source, answered_at,
                        slack_channel, message_ts, prompted_at
mission-hq.locations    value pk (what Slack sends), label, status (what we store)
mission-hq.feedback     moved from the Automations project
```

Three decisions that are load-bearing — do not "simplify" them without reading
the migration headers:

1. **Three states, not two.** No row = never prompted (leaves the denominator);
   `'Pending'` = prompted and ignored (counts against them); anything else = an
   answer. Conflating the first two once dragged a whole group's numbers down.
2. **`exited_at`, not delete.** `sync-employees` deletes leavers. The mirror
   stamps a date instead, so a departure doesn't take 40k attendance rows with
   it, and policy fields survive a rehire for a human to clear.
3. **The mirror trigger swallows its own errors.** It's an `AFTER` trigger on
   another product's table — raising would abort WeCare's nightly sync. A stale
   mirror is a MissionHQ problem; a failed sync is everyone's.

---

## Repo layout

```
supabase/              migrations + edge functions   <- deploy from the repo root
mission-hq/            Next.js dashboard, reads Postgres
mission-hq-app-script/ the Apps Script project — being retired, do not add to it
```

The Supabase side used to live under `mission-hq-app-script/`, which is the
folder this migration exists to delete. Deploy with
`supabase functions deploy mission-hq --project-ref '<SUPABASE_PROJECT_REF>'` from
the repo root.

## Migrations — all applied

| File | What |
|---|---|
| `01_mission_hq_schema.sql` | schema, `employees`, mirror trigger from `public.employees`, seed |
| `02_attendance.sql` | `attendance`, `locations`, `is_business_day()` |
| `03_merge_prompts_into_attendance.sql` | folds `prompts` in — same key, so it was a column set |
| `04_fix_location_values.sql` | `value` must be Slack's hyphenated wire format |
| `05_service_role_grants.sql` | a custom schema inherits none of `public`'s grants |
| `06_lock_down_anon.sql` | fourth gate: no schema `usage` for anon/authenticated |
| `07_prompt_content.sql` | `messages` (35), `trivia` (172), `settings` |
| `08_prompt_views.sql` | `prompt_recipients`, `prompt_gaps` |
| `09_cron.sql` | `invoke_()` + the schedule |
| `10_ist_day.sql` | `today_ist()` — one definition of today, the Indian one |
| `11_reminder.sql` | `reminder_recipients` + its 14:00 job |

## Live on Supabase

```
09:00 IST  mission-hq-prompt   one run, worker pool, drains prompt_recipients
10:00 IST  mission-hq-verify   silent unless somebody was missed
14:00 IST  mission-hq-remind   threaded nudge to whoever is still Pending
any time   mission-hq          Slack submits upsert into mission-hq.attendance
```

Backed by 40,029 rows of history (2025-05-15 → 2026-10-01, verified row-for-row
against the sheet), 347 promptable people, and a calendar reading
`public.holidays` rather than a hand-edited array.

All four verified live end to end. The Slack submit leg is the one still waiting
on a real click.

## Still on Apps Script

| | Note |
|---|---|
| Fortnightly summaries | **next due the 16th — the real deadline** |
| Recovery sweep | much smaller now; its job is the DM cross-check, not walking a sheet |
| Zoho leave sync (in) | needs `ZOHO_*` secrets on WeCare |
| Zoho attendance push (out) | deferred by decision, after everything else |
| POFU roster | deferred by decision; feeds another team's sheet |
| Managers / FLG rosters | Managers can regenerate from `identity_links`; FLG needs a one-off import |
| Dashboard | still reads `doGet?action=all`; repoint to Postgres |
| `WorkCalendar.js` library | **two dependants**: `dinner-poll-automation`, `pofu-automation` |

**PMS levels: dropped, not migrated.** No summary group selects on `PMS Level`
any more — the Managers group reads the roster mirrored from the Slack channel.
Dropping it also means Supabase never needs access to the PMS master
spreadsheet, which holds compensation data.

### WorkCalendar — the exact surface

Verified by searching all 16 repos for the library id. Five functions, two
dependants:

```
dinner-poll-automation   Slack.js:7       isWeekend() || isHoliday()
                         MealPoll.js:187  addBusinessDays(new Date(), 1)
pofu-automation          WorkCalendar.js  one adapter file, all five calls
```

Retiring the Apps Script project breaks both silently. Pause the triggers, keep
the project alive as a library-only shell, and migrate them to read
`public.holidays` whenever.

## Open questions

- Dashboard: Next.js (what exists in `mission-hq/`) or Vite?
- `prompt_opt_in` for the 12 Slack-vs-Zoho people — confirm who should be in
- Do the FLG and Managers rosters become dashboard screens or table-editor tables?

---

## Monday

Leave the Apps Script triggers running for one day. Both systems send — one
extra DM, one morning — and at 10:30 compare:

```sql
select count(*) from "mission-hq".attendance where day = "mission-hq".today_ist();
```

against the sheet's column for the same day. Equal counts is what lets the old
one be switched off without hoping.

## Rollback

Two minutes, at any point before the triggers are deleted:

1. Point Slack interactivity back at
   `https://<SLACK_BOT_PROJECT_REF>.supabase.co/functions/v1/mission-hq` (still
   deployed, still holds its secrets).
2. Unpause the Apps Script triggers.

The sheet is still there and still correct up to 2026-10-01. Nothing in this
migration has deleted anything.
