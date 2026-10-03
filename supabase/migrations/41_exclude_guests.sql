-- ===========================================================================
-- Guests leave the audit.
--
-- The Slack-vs-Zoho list exists to ask one question: "is this a real employee
-- we should be prompting?" For a guest the answer is always no, and it is no
-- for a reason that will never change, so the row is not a decision anybody
-- needs to make. 106 vendor-domain accounts were already filtered in the UI by
-- domain — but the domain was never the signal: multi-channel and invited
-- guests hold @hyperverge.co addresses too, so each one sailed through that
-- filter and was offered a "prompt them" button.
-- `mission-hq.slack_accounts` (migration 40) carries the real flag.
--
-- SAFE TO APPLY BEFORE THE SNAPSHOT EXISTS. If `slack_accounts` is empty —
-- migration 40 applied but mission-hq-directory not yet run — this falls back
-- to the freshness rule it replaces, rather than returning nothing. An empty
-- audit would be read as "all clear", and an empty roster resolution would
-- have taken the Managers summary down with it.
-- ===========================================================================

create or replace view "mission-hq".slack_active as
  select il.email, il.slack_user_id, il.display_name, il.updated_at
    from public.identity_links il
    left join "mission-hq".slack_accounts sa
      on sa.slack_user_id = il.slack_user_id
   where il.email is not null
     and il.email <> ''
     and (
       -- The snapshot is the authority wherever it has an opinion.
       (sa.slack_user_id is not null
         and not sa.deleted
         and not sa.is_bot
         and not sa.is_guest)
       -- Never synced: the pre-snapshot rule, so this view is never empty
       -- merely because a job has not run yet.
       or (
         not exists (select 1 from "mission-hq".slack_accounts)
         and il.updated_at >= "mission-hq".slack_synced_at() - interval '2 days'
       )
     );

comment on view "mission-hq".slack_active is
  'Slack accounts belonging to a real, current member of staff: not '
  'deactivated, not a bot, not a guest. Reads mission-hq.slack_accounts, and '
  'falls back to identity_links freshness if that has never been populated.';

grant select on "mission-hq".slack_active to service_role;
