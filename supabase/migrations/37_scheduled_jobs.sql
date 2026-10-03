-- ===========================================================================
-- Let the dashboard show what is actually scheduled.
--
-- Read from `cron.job` rather than from a list kept in the application, because
-- a hardcoded list is a description of what somebody INTENDED to schedule. The
-- failure this guards against is the one that already happened in Apps Script:
-- a job quietly deleted, with every screen still claiming it runs.
--
-- `cron` is not an exposed schema and service_role cannot read it directly, so
-- this definer function is the one narrow window onto it.
-- ===========================================================================

create or replace function "mission-hq".scheduled_jobs()
returns table (jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = cron, public
as $$
  select j.jobname::text, j.schedule::text, j.active
    from cron.job j
   where j.jobname like 'mission-hq%'
   order by j.schedule;
$$;

grant execute on function "mission-hq".scheduled_jobs() to service_role;
