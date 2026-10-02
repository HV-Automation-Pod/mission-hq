-- ===========================================================================
-- "Who has a live Slack account that Zoho has never heard of", as a view.
--
-- This replaces SlackZohoAudit.js and the spreadsheet tab it wrote. That script
-- paged the whole Slack member list on every run, diffed it against a fresh
-- org-tree fetch, and merged the result into a sheet while trying not to
-- clobber the two columns a human had typed into.
--
-- None of that is needed here. Both sides are already synced daily by WeCare:
-- `public.identity_links` from Slack at 02:00, `public.employees` from Zoho at
-- 06:30. The question is a join between them, so it is a view and it is never
-- stale by more than a few hours.
--
-- THE ANSWER AND THE QUESTION LIVE IN DIFFERENT PLACES, deliberately. This view
-- is derived and read-only; the decision somebody makes about a row
-- (`prompt_opt_in`, `notes`) is a column on `mission-hq.employees`, which is
-- real data. In the sheet those were the same object, which is why that script
-- had to merge rather than rewrite, and why a careless `sheet.clear()` would
-- have destroyed the answers.
--
-- A row here with `in_mission_hq = false` has no employees row at all, so there
-- is nowhere to record a decision yet. The UI should insert one when somebody
-- answers, which is what migration 19 did by hand for thuy.n.
-- ===========================================================================

create or replace view "mission-hq".slack_not_in_zoho as
  select
    lower(il.email)                       as email,
    il.display_name                       as slack_name,
    il.slack_user_id,
    (e.email is not null)                 as in_mission_hq,
    e.full_name,
    e.wfo_exempt,
    coalesce(e.prompt_opt_in, false)      as prompt_opt_in,
    e.notes,
    (e.exited_at is not null)             as exited,
    -- The most common innocent explanation, and the one somebody can act on
    -- fastest: the same person, in Zoho, under a different address.
    zm.email                              as possible_zoho_match
  from public.identity_links il
  left join public.employees z
    on lower(z.email) = lower(il.email)
  left join "mission-hq".employees e
    on e.email = lower(il.email)
  left join lateral (
    select z2.email
      from public.employees z2
     where "mission-hq".norm_(z2.name) = "mission-hq".norm_(il.display_name)
     limit 1
  ) zm on true
 where il.email is not null
   and il.email <> ''
   and z.email is null;

comment on view "mission-hq".slack_not_in_zoho is
  'Slack accounts with no Zoho record. Derived and read-only: record a decision '
  'on mission-hq.employees (prompt_opt_in, notes), never here.';

grant select on "mission-hq".slack_not_in_zoho to service_role;

select count(*) as slack_accounts_not_in_zoho,
       count(*) filter (where in_mission_hq)  as have_a_missionhq_row,
       count(*) filter (where prompt_opt_in)  as marked_prompt_me,
       count(*) filter (where possible_zoho_match is not null) as likely_email_mismatch
  from "mission-hq".slack_not_in_zoho;
