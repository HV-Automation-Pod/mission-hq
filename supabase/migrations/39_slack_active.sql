-- ===========================================================================
-- "A live Slack account", defined once, because the guess was wrong twice.
--
-- `public.identity_links` is synced from Slack nightly, and the sync UPSERTS
-- but never DELETES. A deactivated account therefore does not vanish from the
-- table — it just stops being refreshed, and sits there for ever with the
-- `updated_at` it had on the last day Slack still listed it.
--
-- Two places assumed the opposite, in opposite directions:
--
--   slack_not_in_zoho    showed leavers as unmatched Slack accounts needing a
--                        decision. Seven accounts deactivated in the previous
--                        fortnight were still being offered a "prompt them"
--                        button, five of them in the audit list.
--
--   the Managers roster  WORSE. mission-hq-directory resolves the managers
--                        channel's member ids to emails through this table and
--                        notes that "deactivated accounts are gone from
--                        identity_links". They are not: a leaver still sitting
--                        in the channel resolves perfectly and is written
--                        straight back onto the roster, so the fortnightly
--                        Managers report carries them at 0% — exactly the
--                        failure that job's FIRST half exists to prevent.
--
-- The signal is ABSENCE FROM THE LATEST SYNC, not absence from the table.
-- Measured against the newest row rather than against now(), so a skipped sync
-- run moves the whole cohort together and nobody is wrongly dropped; only a
-- PARTIAL sync could do that, which is what the two-day grace absorbs.
-- ===========================================================================

create or replace function "mission-hq".slack_synced_at()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$ select max(updated_at) from public.identity_links $$;

comment on function "mission-hq".slack_synced_at() is
  'When the Slack directory sync last wrote anything. The freshness of every '
  'answer derived from identity_links is bounded by this, so it is shown in '
  'the admin UI rather than assumed.';

-- ---------------------------------------------------------------------------
-- Slack accounts the most recent sync still listed.
-- ---------------------------------------------------------------------------
create or replace view "mission-hq".slack_active as
  select il.email, il.slack_user_id, il.display_name, il.updated_at
    from public.identity_links il
   where il.email is not null
     and il.email <> ''
     and il.updated_at >= "mission-hq".slack_synced_at() - interval '2 days';

comment on view "mission-hq".slack_active is
  'identity_links minus accounts the nightly Slack sync has stopped seeing. '
  'That is what deactivation looks like here: the sync upserts and never '
  'deletes, so a switched-off account keeps its last updated_at for ever.';

grant select on "mission-hq".slack_active to service_role;

-- ---------------------------------------------------------------------------
-- Same view as before, same columns, reading from slack_active.
-- ---------------------------------------------------------------------------
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
    zm.email                              as possible_zoho_match
  from "mission-hq".slack_active il
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
 where z.email is null;

comment on view "mission-hq".slack_not_in_zoho is
  'Slack accounts with no Zoho record. Derived and read-only: record a decision '
  'on mission-hq.employees, not here. Leavers are excluded by slack_active.';

grant select on "mission-hq".slack_not_in_zoho to service_role;
