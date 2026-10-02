-- ===========================================================================
-- The schedule. pg_cron runs in UTC; IST is +5:30, so every time here is the
-- IST one minus 5:30. Getting that backwards is a silent five-and-a-half-hour
-- error, so each line carries the IST time it means.
--
-- The weekday mask is 1-5, but it is NOT the calendar gate — `prompt_recipients`
-- and `prompt_gaps` both filter on `is_business_day(current_date)`, which knows
-- about Gandhi Jayanti and the cron does not. The mask only saves two wasted
-- wake-ups a week.
--
-- THE SENDER RUNS ELEVEN TIMES, ON PURPOSE.
-- ~347 DMs at Slack's ~1/second is about six minutes, which no single edge
-- function invocation gets. `prompt_recipients` excludes anybody who already
-- has a row, so each call drains what is left and a call with nothing left is
-- a no-op. Eleven minutes of headroom for six minutes of work means a slow
-- morning still finishes before the 10:00 check looks.
--
-- Scheduled with `cron.schedule`, which is an upsert by name — re-running this
-- file reschedules rather than duplicating.
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- WHERE THE URL AND KEY COME FROM.
--
-- Not `ALTER DATABASE ... SET app.settings.*`: that needs superuser, which the
-- `postgres` role on hosted Supabase is not — it fails with
-- `42501 permission denied to set parameter`. They live in the settings table
-- this schema already has, which needs no special privilege and is readable in
-- the dashboard when somebody wonders what cron is calling.
--
-- WHY THE ANON KEY AND NOT THE SERVICE ROLE KEY.
--
-- pg_cron runs inside Postgres, so it sees none of the secrets the platform
-- injects into an edge function — it needs a token of its own just to get past
-- the gateway. But `verify_jwt` only asks "is this a JWT this project signed";
-- it grants nothing. The function's actual authority is the service-role key
-- injected into its own environment, server-side, which never leaves it.
--
-- So cron carries the ANON key: the one that already ships to every browser.
-- `mission-hq.settings` is service-role-only, but even if it were not, the
-- difference between a public key sitting there and a key that bypasses RLS on
-- a database shared with WeCare is the entire point.
-- THESE TWO ROWS ARE SET BY HAND, ONCE, AND ARE NOT IN THIS FILE.
--
-- They name the project and carry a key, and neither belongs in version
-- control — the repo's own rule is placeholders for project refs and secrets.
-- The rows already exist in the database; this is here so the next person knows
-- what `invoke_()` is reading and can recreate it on a new project:
--
--   insert into "mission-hq".settings (key, value) values
--     ('edge_base_url',   '"https://<SUPABASE_PROJECT_REF>.supabase.co"'::jsonb),
--     ('edge_invoke_key', '"<ANON_KEY>"'::jsonb)
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- `invoke_()` raises if either is missing, so a fresh environment fails loudly
-- at the first cron tick rather than posting to "null/functions/v1/...".

create or replace function "mission-hq".invoke_(fn text)
returns void
language plpgsql
security definer
set search_path = "mission-hq", public, extensions
as $$
declare
  base text;
  key  text;
begin
  select value #>> '{}' into base from "mission-hq".settings where key = 'edge_base_url';
  select value #>> '{}' into key  from "mission-hq".settings where key = 'edge_invoke_key';

  -- A cron job that posts to "null/functions/v1/..." fails quietly in net's
  -- response table, where nobody is looking. Fail loudly instead.
  if base is null or key is null then
    raise exception 'mission-hq.settings is missing edge_base_url or edge_invoke_key';
  end if;

  perform net.http_post(
    url     := base || '/functions/v1/' || fn,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || key),
    body    := '{}'::jsonb
  );
end;
$$;

comment on function "mission-hq".invoke_(text) is
  'Fires an edge function from cron. Carries the ANON key deliberately: it only '
  'has to satisfy verify_jwt, and the function gets its real authority from the '
  'service-role key injected into its own environment.';

-- 09:00 IST = 03:30 UTC. One run sends the whole org: the sender uses a worker
-- pool, and Slack's ~1/second limit on chat.postMessage is per CHANNEL, so 400
-- DMs to 400 different channels finish in well under a minute.
--
-- The weekday mask is 1-5, but it is NOT the calendar gate — `prompt_recipients`
-- and `prompt_gaps` both filter on `is_business_day(current_date)`, which knows
-- about Gandhi Jayanti and a cron expression does not. The mask only saves two
-- wasted wake-ups a week.
--
-- `cron.schedule` upserts by name, so re-running this file reschedules rather
-- than duplicating. The eleven-job version this replaces is unscheduled below.
select cron.schedule('mission-hq-prompt', '30 3 * * 1-5', $$select "mission-hq".invoke_('mission-hq-prompt')$$);

-- 10:00 IST = 04:30 UTC. An hour later: anyone still in `prompt_gaps` never got
-- their message, and that is the only thing worth saying out loud.
select cron.schedule('mission-hq-verify', '30 4 * * 1-5', $$select "mission-hq".invoke_('mission-hq-verify')$$);

-- Clean up the eleven-job design, so a re-run of this file leaves exactly two.
do $$
declare j text;
begin
  foreach j in array array[
    'mission-hq-prompt-00','mission-hq-prompt-01','mission-hq-prompt-02','mission-hq-prompt-03',
    'mission-hq-prompt-04','mission-hq-prompt-05','mission-hq-prompt-06','mission-hq-prompt-07',
    'mission-hq-prompt-08','mission-hq-prompt-09','mission-hq-prompt-10']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;
