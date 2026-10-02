-- ===========================================================================
-- Schedule the fortnightly summary. DAILY, and that is the whole point.
--
-- `periodFor()` inside the function returns null on the ~28 days that are
-- neither the 1st nor the 16th, and the run ends immediately. So this fires 365
-- times a year and posts 24.
--
-- Apps Script used two monthly triggers instead, one per date. In the triggers
-- UI those look like duplicates: same function, same hour, both showing
-- "Last run: -" until one of them fires. On 2026-09-14 somebody deleted the
-- 16th as a duplicate, two days before it was due, and the first half of that
-- month was never reported. Nobody noticed until the next cycle.
--
-- A job that wakes every morning and decides not to fire cannot be deleted by
-- mistake, and a day missed to an outage is retried the next morning rather
-- than lost for a fortnight. Double-posting is prevented by the
-- `summary_last_sent` row in settings, not by the schedule, so a retry after a
-- partial failure is safe. The pattern is taken from resolve-os's monthly
-- report, which solved the same problem.
--
-- 10:10 IST = 04:40 UTC. Ten minutes after the attendance verification so the
-- two never contend, and late enough that the day it reports on is long over.
-- ===========================================================================

select cron.schedule(
  'mission-hq-summary',
  '40 4 * * *',
  $$select "mission-hq".invoke_('mission-hq-summary')$$
);

select jobname, schedule, active
  from cron.job
 where jobname like 'mission-hq%'
 order by jobname;
