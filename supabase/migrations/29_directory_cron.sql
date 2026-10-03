-- ===========================================================================
-- 08:30 IST (03:00 UTC): directory housekeeping, before everything else.
--
-- Twenty minutes ahead of the leave sync and thirty ahead of the prompt, so a
-- newly deactivated account is retired BEFORE the morning's DM goes out rather
-- than after. Getting that order wrong means a leaver is messaged one more
-- time and scored Pending for it.
-- ===========================================================================

select cron.schedule('mission-hq-directory', '0 3 * * 1-5',
  $$select "mission-hq".invoke_('mission-hq-directory')$$);

select jobname, schedule, active from cron.job
 where jobname like 'mission-hq%' order by schedule;
