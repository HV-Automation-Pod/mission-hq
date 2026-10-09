-- ===========================================================================
-- The 14:00 nudge can now @ the person.
--
-- It addressed people as plain text: "Satish, a quick nudge". That was not a
-- wording choice. `reminder_recipients` never selected a Slack id, so the job
-- had nothing to build a mention out of — `prompt_recipients` has carried
-- `slack_user_id` since migration 08 and this view simply never did.
--
-- It matters more here than anywhere else in the system. A plain name in a
-- threaded reply gets no badge and no mention highlight, and the entire reason
-- the 14:00 run exists is to reach somebody who already missed the 09:00 DM.
-- The one message aimed at people who are not paying attention was the one
-- message that did not ping.
--
-- READ THROUGH `slack_active`, NOT `identity_links` DIRECTLY. The sync UPSERTS
-- AND NEVER DELETES (migration 39), and the table is unique on `slack_user_id`
-- rather than on email, so somebody who was deactivated and re-added holds TWO
-- rows under one address. A plain join against the raw table would therefore
-- duplicate their row and nudge them twice, and could paste the dead account's
-- id into the mention. `slack_active` already drops deactivated accounts, bots
-- and guests.
--
-- EVEN SO, `LATERAL ... LIMIT 1`, which is the house pattern here (see
-- `slack_not_in_zoho`). It makes one-row-per-person a property of the view
-- rather than an assumption about the data underneath it. Newest sync wins.
--
-- LEFT, NOT INNER. An inner join would silently drop anybody without a live
-- Slack link out of the reminder list, turning a cosmetic fix into people
-- quietly no longer being nudged at all. Null is allowed through and the job
-- falls back to the first name.
--
-- APPENDED, NOT INSERTED. `create or replace view` cannot add a column
-- mid-list (42P16). Last is the one position that avoids a drop, and dropping
-- this view would take its grant with it.
--
-- Still SECURITY DEFINER by default, which is load bearing now that this
-- reaches into `public`: service_role has no grant on `identity_links` and the
-- view's owner does. See the header of migration 08.
-- ===========================================================================

create or replace view "mission-hq".reminder_recipients as
  select
    a.email,
    e.full_name,
    a.slack_channel,
    a.message_ts,
    sa.slack_user_id
  from "mission-hq".attendance a
  join "mission-hq".employees e on e.email = a.email
  left join lateral (
    select s.slack_user_id
      from "mission-hq".slack_active s
     where lower(s.email) = a.email
     order by s.updated_at desc
     limit 1
  ) sa on true
 where a.day = "mission-hq".today_ist()
   and a.status = 'Pending'
   and a.slack_channel is not null
   and a.message_ts is not null
   and e.wfo_exempt is null
   and "mission-hq".is_business_day("mission-hq".today_ist());

comment on view "mission-hq".reminder_recipients is
  'Still Pending at reminder time. Empty is the healthy state; the reminder '
  'job says nothing when it is. slack_user_id is nullable on purpose: no live '
  'Slack link must cost somebody the mention, never the nudge.';

grant select on "mission-hq".reminder_recipients to service_role;
