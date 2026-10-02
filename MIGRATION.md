# MissionHQ: Google Sheets → Supabase

Living runbook. Updated as the migration proceeds — if something here disagrees
with the code, the code is right and this file is stale; fix it.

**Last updated:** 2026-10-04

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

**Project: WeCare** (`jsehiivvzalvcrlybmlf`, org Compass, PRO) — *not* Automations.

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
`supabase functions deploy mission-hq --project-ref jsehiivvzalvcrlybmlf` from
the repo root.

## Migrations

| File | What | Status |
|---|---|---|
| `01_mission_hq_schema.sql` | schema, `employees`, mirror trigger, seed | ✅ applied |
| `02_attendance.sql` | `attendance`, `prompts`, `locations`, `is_business_day()` | ✅ applied |
| `03_merge_prompts_into_attendance.sql` | folds `prompts` in, drops the table | ✅ applied |
| `04_fix_location_values.sql` | `value` must be Slack's hyphenated form | ⬜ **run this** |

`04` matters before any real submit: Slack sends `Split-Day`, not `Split Day`.
Without it every multi-word answer misses its row.

---

## Done

- **Schema live** in WeCare, RLS on with no policies (deny-all; the dashboard
  uses the service role, which bypasses it).
- **History backfilled and verified** — exact match, nothing lost:

  ```
  employees 375   attendance 40,029   pending 12,005   answered 28,024
  2025-05-15 → 2026-10-01
  ```

  375 > Zoho's 351: the extra 24 are leavers with history plus the people whose
  HR record sits under a second address. All stamped `exited_at` on import, so
  the history exists and they are not prompted.
- `BackfillToSupabase.js` — CSV and SQL generators, idempotent, in Apps Script.
- Slack secrets set on WeCare: signing secret, bot token.
- Edge function deployed to Automations and the Slack URL pointed at it — **this
  was a wrong turn**, see Pending.

## In progress

- **Rewrite `mission-hq` edge function**: on submit, upsert
  `mission-hq.attendance` instead of forwarding to Apps Script. Also read the
  picker options from `mission-hq.locations` rather than `?action=locations`.
- **New `mission-hq-prompt` edge function** + `pg_cron` at 10:09 IST
  (04:39 UTC): read active employees, join `identity_links` for the Slack id,
  gate on `is_business_day()`, send the DM, insert the `'Pending'` row with its
  `message_ts`.

## Pending

**Blocking Monday 2026-10-05, 10:09 IST**

- [ ] Run `04_fix_location_values.sql`
- [ ] **Expose `mission-hq` in Settings → API → Exposed schemas** — PostgREST
      cannot see the schema otherwise, and every edge-function query 404s
- [ ] Deploy the rewritten function to **WeCare**
- [ ] Repoint Slack interactivity to
      `https://jsehiivvzalvcrlybmlf.supabase.co/functions/v1/mission-hq`
- [ ] Delete the Automations deployment so no stray copy can answer
- [ ] `MISSION_HQ_SLACK_USER_TOKEN` on WeCare (truncated in the screenshot) —
      without it the Slack profile-status update throws
- [ ] Pause the Apps Script triggers — **pause, not delete**, until Monday proves out

**After Monday**

- [ ] Reminder flow + its pre-send DM check
- [ ] Recovery sweep — much smaller now; its job is the Slack DM cross-check,
      not walking a sheet
- [ ] Fortnightly summaries (next due the **16th**) + a materialised summary
      table so the report doesn't rescan history
- [ ] Zoho leave sync (read) and attendance push (write) — needs
      `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` on WeCare
- [ ] Dashboard: repoint `/api/data` from Apps Script to Postgres, then the
      write screens — edit a day, toggle `wfo_exempt`, FLG roster, the
      Slack-vs-Zoho decision
- [ ] Decide `WorkCalendar.js`'s fate — it is a **published Apps Script library**
      and `dinner-poll-automation` and `pofu-automation` depend on it. Retiring
      the project breaks them.
- [ ] Decide `PofuSync.js` — writes to another team's spreadsheet; from Supabase
      that needs a Google service account
- [ ] Drop PMS level sync? No summary group selects on it any more

## Open questions

- Dashboard: Next.js (what exists in `mission-hq/`) or Vite?
- `prompt_opt_in` for the 12 Slack-vs-Zoho people — confirm who should be in
- Do the FLG and Managers rosters become dashboard screens or table-editor tables?

---

## Cutover (Monday)

1. Apply `04`. Expose the schema. Set the user token.
2. Deploy the function to WeCare; smoke-test it.
3. Flip the Slack interactivity URL.
4. Pause the Apps Script triggers.
5. Watch the 10:09 cron. Check `select count(*) from "mission-hq".attendance where day = current_date`.

## Rollback

Two minutes, at any point before the triggers are deleted:

1. Point Slack interactivity back at
   `https://riiisqzwbhlytogcjdmn.supabase.co/functions/v1/mission-hq` (still
   deployed, still holds its secrets).
2. Unpause the Apps Script triggers.

The sheet is still there and still correct up to 2026-10-01. Nothing in this
migration has deleted anything.
