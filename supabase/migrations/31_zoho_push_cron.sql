-- ===========================================================================
-- 19:30 IST (14:00 UTC): push the day into Zoho's muster roll.
--
-- Late in the evening, after the nominal 18:30 check-out it records and long
-- after people have answered. The Apps Script version ran at 10:34 and pushed
-- YESTERDAY, because today's data is half-finished in the morning. This pushes
-- whatever is owed instead, so it needs no such rule: a day that is still being
-- answered simply has fewer rows ready, and they go in the next run.
--
-- Weekdays only. A weekend has no attendance rows to push, and a late answer
-- made on a Saturday is picked up on Monday.
-- ===========================================================================

select cron.schedule('mission-hq-zoho-push', '0 14 * * 1-5',
  $$select "mission-hq".invoke_('mission-hq-zoho-push')$$);

select jobname, schedule, active from cron.job
 where jobname like 'mission-hq%' order by schedule;
