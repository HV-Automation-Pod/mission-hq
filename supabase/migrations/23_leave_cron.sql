-- ===========================================================================
-- Leave runs twice: before the prompts, and again after them.
--
-- 08:50 IST (03:20 UTC) is ten minutes ahead of the 09:00 send, so anybody on
-- approved leave is already marked and never gets the DM.
--
-- 13:50 IST (08:20 UTC) catches leave approved during the morning, ten minutes
-- before the 14:00 reminder, so somebody whose leave was approved at 11am is
-- not nudged about a day they are not working.
--
-- The second pass is free and cannot do harm: `mark_leave` only ever converts a
-- blank or `Pending` day, so anybody who has already answered keeps their
-- answer. That property is what makes running it repeatedly safe, and it is
-- worth more than the ten minutes it buys.
-- ===========================================================================

select cron.schedule('mission-hq-leave-am', '20 3 * * 1-5', $$select "mission-hq".invoke_('mission-hq-leave')$$);
select cron.schedule('mission-hq-leave-pm', '20 8 * * 1-5', $$select "mission-hq".invoke_('mission-hq-leave')$$);

select jobname, schedule, active from cron.job where jobname like 'mission-hq%' order by schedule;
