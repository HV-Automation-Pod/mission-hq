-- ===========================================================================
-- `invoke_()` has raised on every cron tick since it was created.
--
--   declare key text;                                   -- the variable
--   select ... from "mission-hq".settings where key = ...  -- the column
--
-- `settings` has a column named `key`, so both predicates are ambiguous and
-- PL/pgSQL's default `variable_conflict = error` raises 42702. It raises at
-- EXECUTION, not at `create function`, which is why the migration applied
-- cleanly and nothing ever said otherwise.
--
-- WHAT THIS COST. Friday 2026-10-03 was a working day and carries ONE
-- attendance row, against ~345 on each of 09-29, 09-30 and 10-01. Nobody was
-- prompted, nobody was reminded, nothing was pushed to Zoho.
--
-- AND IT WAS SILENT BY CONSTRUCTION. pg_cron records the failure in
-- `cron.job_run_details` and nowhere else. Every alert in this system lives
-- INSIDE the edge function that was never reached, so the alert channel stayed
-- quiet. The Jobs tab reads `cron.job`, which still showed all eight as active:
-- the screen built to prove the jobs run was showing green over a dead cycle.
--
-- The alias is the fix. The rename is so the next person sees why.
-- ===========================================================================

create or replace function "mission-hq".invoke_(fn text)
returns void
language plpgsql
security definer
set search_path = "mission-hq", public, extensions
as $$
declare
  v_base text;
  v_key  text;
begin
  select s.value #>> '{}' into v_base from "mission-hq".settings s where s.key = 'edge_base_url';
  select s.value #>> '{}' into v_key  from "mission-hq".settings s where s.key = 'edge_invoke_key';

  if v_base is null or v_key is null then
    raise exception 'mission-hq.settings is missing edge_base_url or edge_invoke_key';
  end if;

  perform net.http_post(
    url     := v_base || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb
  );
end $$;

-- ---------------------------------------------------------------------------
-- Prove it, rather than assume it.
--
-- `invoke_` returns void and posts asynchronously, so a successful call tells
-- you only that the SQL ran. That is exactly what was broken, so it is exactly
-- what is worth asserting.
-- ---------------------------------------------------------------------------
do $$
begin
  perform "mission-hq".invoke_('mission-hq-verify');
  raise notice 'invoke_() executed without raising. Previously: 42702 ambiguous "key".';
end $$;

-- After this, check what cron has actually been doing. This is the view that
-- would have caught it on day one, and nothing was reading it.
--
-- The name lives on `cron.job` and the outcome on `cron.job_run_details`, so it
-- is a join — `job_run_details` has `jobid`, not `jobname`:
--
--   select j.jobname, d.status, d.return_message, d.start_time, d.end_time
--     from cron.job_run_details d
--     join cron.job j on j.jobid = d.jobid
--    where j.jobname like 'mission-hq%'
--    order by d.start_time desc
--    limit 20;
--
-- `status` is 'succeeded' when the HTTP POST was DISPATCHED, which is all this
-- proves: net.http_post is asynchronous and the function's own outcome is not
-- recorded here. For that, the alert channel, or:
--
--   select * from net._http_response order by created desc limit 20;
