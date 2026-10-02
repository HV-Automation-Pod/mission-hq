-- ===========================================================================
-- Who to prompt, and who was missed. Both as views, deliberately.
--
-- These two questions are the whole daily cycle, and each of them has a clause
-- that is easy to leave out and expensive to leave out:
--
--   * the business-day gate. Without it the 10:00 check reports all ~347 people
--     as missed every Saturday, and an alert that fires every weekend is one
--     nobody reads by the third week. The cron's `1-5` weekday mask is NOT this
--     gate — it cannot know that 2 October is Gandhi Jayanti.
--
--   * the "already has a row" exclusion. Without it a re-run of the sender DMs
--     everybody a second time.
--
-- Putting them in SQL means the edge functions cannot express the question
-- wrongly, and the dashboard asks the same question the alert does.
--
-- These are SECURITY DEFINER views (the Postgres default), which is load
-- bearing: they read `public.identity_links`, and service_role has no grant
-- there. The view's owner does. That keeps MissionHQ's reach into `public`
-- confined to these two definitions rather than spread across a schema grant.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- prompt_recipients — everyone who should get a DM today, and nobody else
--
-- `prompt_opt_in` overrides `exited_at` on purpose: it is the human override for
-- the case the automatic signals get wrong, which here is a live employee whose
-- HR record sits under a different email. The Zoho feed not listing them is
-- exactly why they need the override.
--
-- `wfo_exempt` is NOT overridden by it. Exempt is somebody deciding this person
-- should not be asked at all; opt-in is somebody deciding an absent HR record is
-- wrong. The second does not imply the first.
-- ---------------------------------------------------------------------------
create or replace view "mission-hq".prompt_recipients as
  select
    e.email,
    e.full_name,
    e.team,
    e.location,
    il.slack_user_id
  from "mission-hq".employees e
  left join public.identity_links il
    on lower(il.email) = e.email
 where (e.exited_at is null or e.prompt_opt_in)
   and e.wfo_exempt is null
   and "mission-hq".is_business_day(current_date)
   and not exists (
         select 1
           from "mission-hq".attendance a
          where a.email = e.email
            and a.day = current_date
       );

comment on view "mission-hq".prompt_recipients is
  'Who still needs a DM today. Empty on weekends and holidays, and empty once '
  'everybody has a row — so the sender is safe to run twice.';

-- ---------------------------------------------------------------------------
-- prompt_gaps — who should have been prompted and was not
--
-- Read at 10:00, an hour after the send. Anything here is a person the bot
-- silently skipped, which is the failure worth waking somebody for: they will
-- be counted as not checked in, for a message they never received.
--
-- Deliberately the same definition as prompt_recipients. If the sender did its
-- job this is empty, so "what is left" and "what was missed" are the same query
-- asked an hour apart — one definition, no drift between the two.
-- ---------------------------------------------------------------------------
create or replace view "mission-hq".prompt_gaps as
  select * from "mission-hq".prompt_recipients;

comment on view "mission-hq".prompt_gaps is
  'Read at 10:00: anybody still here never got their DM. Empty is the healthy '
  'state and the only state that stays quiet.';

grant select on "mission-hq".prompt_recipients to service_role;
grant select on "mission-hq".prompt_gaps       to service_role;
