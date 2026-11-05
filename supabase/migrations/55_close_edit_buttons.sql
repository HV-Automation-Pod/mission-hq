-- ===========================================================================
-- Past days stop being editable from Slack.
--
-- The DM's Edit button reopens the picker for the day the message is about.
-- After that day ends, the answer is a record, and changing it is an admin's
-- call (the dashboard's correction flow), not a click on an old message.
--
-- THE BUTTON IS COSMETIC, THE WEBHOOK IS THE CONTROL. The webhook now refuses
-- an Edit click on a past day, so a stale button is harmless. This migration is
-- the tidy-up: a nightly job at 00:15 IST removes the button from the last few
-- days' messages so it stops being offered at all.
--
-- WHY A TABLE AND NOT A COLUMN ON attendance. `touch_updated_at_` (32) bumps
-- `updated_at` on nearly any update, and `zoho_push_queue` reads that as "edited
-- since it was sent". Stamping 350 rows a night on attendance would re-queue all
-- of them for Zoho and break the admin correction's version check. A separate
-- ledger has no trigger and no side effects.
--
-- THE WINDOW IS FIVE DAYS, not all history. It covers a long weekend plus a
-- missed run, and it means the first run cleans a bounded backlog (about five
-- days of messages) rather than every message ever sent. Older buttons are
-- left alone; the webhook refuses them anyway.
--
-- Pending rows are excluded on purpose: a Pending DM carries the picker and
-- Submit, not Edit, and must never be touched here.
-- ===========================================================================

create table if not exists "mission-hq".slack_edit_closed (
  email      text        not null,
  day        date        not null,
  closed_at  timestamptz not null default now(),
  primary key (email, day)
);

comment on table "mission-hq".slack_edit_closed is
  'Days whose Slack DM has been checked and had its Edit button removed (or had none). Ledger only; nothing else reads it.';

alter table "mission-hq".slack_edit_closed enable row level security;
revoke all on "mission-hq".slack_edit_closed from anon, authenticated;
grant select, insert on "mission-hq".slack_edit_closed to service_role;

create or replace view "mission-hq".edit_closable as
  select a.email, a.day, a.slack_channel, a.message_ts
    from "mission-hq".attendance a
   where a.slack_channel is not null
     and a.message_ts    is not null
     and a.status <> 'Pending'
     and a.day <  "mission-hq".today_ist()
     and a.day >= "mission-hq".today_ist() - 5
     and not exists (
           select 1
             from "mission-hq".slack_edit_closed c
            where c.email = a.email
              and c.day   = a.day
         );

revoke all on "mission-hq".edit_closable from anon, authenticated;
grant select on "mission-hq".edit_closable to service_role;

-- 00:15 IST is 18:45 UTC. Slack allows roughly 50 chat.update per minute, so a
-- 350-message night is about seven minutes of work and the first night's
-- five-day backlog about an hour. The job works in batches and stops at its
-- time budget, so it is simply invoked every three minutes until 01:27 IST;
-- once the view is empty each call is a single cheap query. Every day, not
-- Monday to Friday: Friday's buttons close on Saturday's run.
select cron.schedule('mission-hq-close-edit-a', '45-59/3 18 * * *', $$select "mission-hq".invoke_('mission-hq-close-edit')$$);
select cron.schedule('mission-hq-close-edit-b', '*/3 19 * * *',     $$select "mission-hq".invoke_('mission-hq-close-edit')$$);
