-- ===========================================================================
-- MissionHQ: the schema that replaces the "MissionHQ Log" spreadsheet.
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- Attendance lived in a Google Sheet: one row per person, one COLUMN per day,
-- 376 x 346 cells and growing. Every job read the whole grid, and Apps Script
-- caps an execution at six minutes, so the recovery sweep started timing out
-- partway down the sheet and the rows below it were silently never checked.
-- Two date columns for the same day was its own class of bug (a write landing
-- in the column the prompt flow no longer considered canonical).
--
-- Both of those are properties of the storage, not of the logic. One row per
-- person per day with `unique (email, day)` makes the duplicate impossible to
-- represent, and "who is still pending on day X" an index lookup instead of a
-- full-grid scan.
--
-- WHY IN THE WeCare PROJECT
-- ---------------------------------------------------------------------------
-- Because the hard parts are already here, maintained daily and in production:
--
--   public.employees        351 people from the Zoho org tree, 06:30 daily
--   public.identity_links   slack_user_id <-> email, unique on the slack id, 02:00 daily
--   public.holidays         date -> name, with an admin screen
--   pg_cron + pg_net        nine jobs already running on them
--
-- MissionHQ was maintaining its own hand-rolled copy of every one of those.
--
-- OWNERSHIP BOUNDARY — the rule this file does not break
-- ---------------------------------------------------------------------------
-- `public` belongs to resolve-os. Nothing in MissionHQ writes to it, and
-- MissionHQ owns no columns there. The one dependency is one-way and read-only:
-- the trigger at the bottom mirrors `public.employees` into this schema.
--
-- The schema name is quoted everywhere because it is hyphenated. That was set
-- by the dashboard's existing client (`db: { schema: "mission-hq" }`) and the
-- feedback table it already talks to, so it is kept rather than "corrected".
-- ===========================================================================

create schema if not exists "mission-hq";

comment on schema "mission-hq" is
  'MissionHQ attendance. Reads public.employees / identity_links / holidays; '
  'writes nothing outside this schema.';

-- The dashboard talks to this schema with the service role; PostgREST needs it
-- exposed to see it at all.
grant usage on schema "mission-hq" to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- employees — MissionHQ's own copy, mirrored from public.employees
--
-- A copy rather than a join, for one reason that matters: `sync-employees`
-- DELETES anyone the Zoho feed stops listing. That is the correct behaviour for
-- WeCare, and it is also how MissionHQ learns somebody has left — but a delete
-- would take a foreign key, and with it the person's attendance history, out
-- with them. Here the mirror sets `exited_at` instead, so the history survives
-- the departure and a returning employee keeps their record.
--
-- Everything above `exited_at` is Zoho's and is overwritten on every sync.
-- Everything below it is MissionHQ's own and is never touched by the mirror.
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".employees (
  email            text primary key,

  -- Mirrored from public.employees. Do not hand-edit: the next sync wins.
  full_name        text,
  emp_id           text,
  team             text,
  location         text,
  date_of_joining  text,
  employment_type  text,

  -- Set when the Zoho feed stops listing them; cleared if they come back.
  -- Null means currently employed.
  exited_at        timestamptz,

  -- MissionHQ's own fields, never written by the mirror.
  --
  -- wfo_exempt holds the REASON, not a boolean: "Exited 2026-09-17",
  -- "Maternity leave", "Contractor". Null means they are prompted. A reason is
  -- what makes a wrong exemption reversible by a human who can see why it was
  -- set, and the sheet column it replaces worked the same way.
  wfo_exempt       text,

  -- An explicit human "prompt this person anyway", for someone the Zoho feed
  -- does not list. It outranks every automatic exit signal, because it is the
  -- override for exactly the case those signals get wrong: a live employee
  -- whose HR record sits under a different email.
  prompt_opt_in    boolean not null default false,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table "mission-hq".employees is
  'Mirror of public.employees plus MissionHQ policy fields. Mirrored columns '
  'are overwritten by the trigger on every sync; wfo_exempt, prompt_opt_in and '
  'notes are MissionHQ''s and are never touched by it.';

comment on column "mission-hq".employees.exited_at is
  'Set when public.employees stops listing them (sync-employees deletes '
  'leavers). Cleared if they reappear. Null = currently employed.';

comment on column "mission-hq".employees.prompt_opt_in is
  'Human override: prompt this person even though Zoho does not list them. '
  'Outranks exited_at.';

create index if not exists employees_active_idx
  on "mission-hq".employees (email)
  where exited_at is null and wfo_exempt is null;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Enabled with NO policies, which means: deny everyone. That is not an
-- oversight, it is the intended state.
--
-- The only client is the dashboard, and it connects with the SERVICE ROLE key
-- (`supabaseAdmin.ts`), which bypasses RLS entirely — so locking these tables
-- costs MissionHQ nothing. What it buys is that WeCare's own `anon` and
-- `authenticated` keys, which belong to a different product sharing this
-- database, cannot read 350 people's attendance. Today they lack table grants
-- anyway; RLS means a future `grant` cannot quietly open it.
--
-- Add a policy here the day a signed-in human reads these tables directly
-- rather than through the dashboard's server. Until then, deny-all is correct.
-- ---------------------------------------------------------------------------
alter table "mission-hq".employees enable row level security;

revoke all on all tables in schema "mission-hq" from anon, authenticated;


-- ---------------------------------------------------------------------------
-- The mirror itself.
--
-- A trigger rather than a change to resolve-os's `sync-employees`: that
-- function belongs to another repo on a daily cron, and a deploy from there
-- would quietly revert an edit made here. A trigger cannot be undone by
-- somebody else's deploy, and it also catches writes the function does not make
-- (a hand-fixed row in the table editor, a one-off backfill).
--
-- IT SWALLOWS ITS OWN ERRORS, AND THAT IS THE POINT. This is an AFTER trigger
-- on another product's table: raising here would abort the transaction that
-- fired it, so a bug in MissionHQ's mirror would take down WeCare's nightly
-- employee sync. A stale mirror is a MissionHQ problem that the next sync
-- fixes; a failed sync is everybody's problem. The warning is what makes the
-- staleness findable in the Postgres logs rather than silent.
-- ---------------------------------------------------------------------------
create or replace function "mission-hq".mirror_employee_()
returns trigger
language plpgsql
security definer
set search_path = "mission-hq", public
as $$
begin
  if tg_op = 'DELETE' then
    -- Gone from the Zoho feed. Keep the row and the history behind it; just
    -- stop prompting them.
    update "mission-hq".employees
       set exited_at  = coalesce(exited_at, now()),
           updated_at = now()
     where email = old.email;
    return old;
  end if;

  insert into "mission-hq".employees as e (
    email, full_name, emp_id, team, location, date_of_joining, employment_type,
    exited_at, updated_at
  )
  values (
    new.email, new.name, new.emp_id, new.team, new.location,
    new.date_of_joining, new.employment_type,
    null, now()
  )
  on conflict (email) do update set
    full_name       = excluded.full_name,
    emp_id          = excluded.emp_id,
    team            = excluded.team,
    location        = excluded.location,
    date_of_joining = excluded.date_of_joining,
    employment_type = excluded.employment_type,
    -- Listed by Zoho again: they are back. The policy fields deliberately do
    -- NOT reset — an exemption somebody set by hand survives a rehire, and a
    -- human can see it and clear it.
    exited_at       = null,
    updated_at      = now();

  return new;

exception when others then
  raise warning 'mission-hq mirror skipped % for %: %', tg_op, coalesce(new.email, old.email), sqlerrm;
  return coalesce(new, old);
end;
$$;

drop trigger if exists mirror_employee on public.employees;
create trigger mirror_employee
  after insert or update or delete on public.employees
  for each row execute function "mission-hq".mirror_employee_();

-- Seed from whatever is in there right now, so the mirror does not have to wait
-- for tomorrow's 06:30 sync to become useful.
insert into "mission-hq".employees as e (
  email, full_name, emp_id, team, location, date_of_joining, employment_type
)
select email, name, emp_id, team, location, date_of_joining, employment_type
  from public.employees
on conflict (email) do update set
  full_name       = excluded.full_name,
  emp_id          = excluded.emp_id,
  team            = excluded.team,
  location        = excluded.location,
  date_of_joining = excluded.date_of_joining,
  employment_type = excluded.employment_type,
  exited_at       = null,
  updated_at      = now();
