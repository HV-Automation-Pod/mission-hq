-- ===========================================================================
-- Who still has not answered, at 14:00.
--
-- `status = 'Pending'` is the whole question — the row exists, so they were
-- asked, and it still says Pending, so they have not replied. In the sheet this
-- needed a scan of the day's column; here it is an index hit on
-- (day, status).
--
-- `message_ts` is required, not optional. The reminder is a threaded reply to
-- the prompt DM, not a second DM: a new message would sit below the first and
-- read as the bot having lost the original. No ts means nothing to reply to,
-- and that person is a `prompt_gaps` problem rather than a reminder one.
-- ===========================================================================

create or replace view "mission-hq".reminder_recipients as
  select
    a.email,
    e.full_name,
    a.slack_channel,
    a.message_ts
  from "mission-hq".attendance a
  join "mission-hq".employees e on e.email = a.email
 where a.day = "mission-hq".today_ist()
   and a.status = 'Pending'
   and a.slack_channel is not null
   and a.message_ts is not null
   and e.wfo_exempt is null
   and "mission-hq".is_business_day("mission-hq".today_ist());

comment on view "mission-hq".reminder_recipients is
  'Still Pending at reminder time. Empty is the healthy state; the reminder job '
  'says nothing when it is.';

grant select on "mission-hq".reminder_recipients to service_role;

-- 14:00 IST = 08:30 UTC.
select cron.schedule('mission-hq-remind', '30 8 * * 1-5', $$select "mission-hq".invoke_('mission-hq-remind')$$);
