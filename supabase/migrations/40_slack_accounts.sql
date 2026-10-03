-- ===========================================================================
-- What Slack actually says about each account, kept rather than thrown away.
--
-- `public.identity_links` carries four columns — email, slack_user_id,
-- display_name, updated_at — and that is all WeCare's sync needs. It cannot
-- answer the two questions MissionHQ keeps asking of it:
--
--   is this account switched off?   Inferred, until now, from the row having
--                                   stopped being refreshed. That works, but
--                                   it is an inference with a two-day lag.
--
--   is this person a GUEST?         Not answerable at all. And the domain is
--                                   not a proxy for it: multi-channel and
--                                   invited guests here hold @hyperverge.co
--                                   addresses like anybody else. Filtering the
--                                   Slack-vs-Zoho audit by domain therefore let
--                                   every one of them through, offering a
--                                   "prompt them" button for people who are
--                                   vendors, not staff.
--
-- `users.list` answers both, and mission-hq-directory ALREADY pages the entire
-- member list every night to find deactivations — it just discarded everything
-- except `deleted`. This table is that same response, kept.
--
-- Nothing reads it yet. The view that will is repointed in migration 41, once
-- this has been populated by a real run, so that an empty table can never
-- silently empty the audit or the Managers roster.
-- ===========================================================================

create table if not exists "mission-hq".slack_accounts (
  slack_user_id text primary key,
  email         text,
  display_name  text,

  -- Straight from users.list. A guest is `is_restricted` (multi-channel) or
  -- `is_ultra_restricted` (single-channel); Slack models them as two flags and
  -- MissionHQ has no reason to care which, so they collapse into one.
  is_bot        boolean not null default false,
  is_guest      boolean not null default false,
  deleted       boolean not null default false,

  synced_at     timestamptz not null default now()
);

create index if not exists slack_accounts_email_idx
  on "mission-hq".slack_accounts (lower(email));

comment on table "mission-hq".slack_accounts is
  'A snapshot of Slack users.list, rewritten whole by mission-hq-directory. '
  'The authority on deactivated and guest accounts, which identity_links '
  'cannot express and the email domain does not imply.';

-- ---------------------------------------------------------------------------
-- Replace the snapshot in one transaction.
--
-- users.list returns the COMPLETE member list, so this is a replace and not a
-- merge: an account Slack no longer returns should leave, and a diff would
-- only be a slower way of arriving there.
--
-- An empty array is refused. The caller passing nothing is indistinguishable
-- from a workspace with no members, and the expensive mistake — wiping the
-- table and taking the audit and the Managers roster down with it — is the one
-- that must not be reachable by accident. `replace_roster` refuses the same
-- way and for the same reason.
-- ---------------------------------------------------------------------------
create or replace function "mission-hq".sync_slack_accounts(p_rows jsonb)
returns table (total int, humans int, guests int, bots int, deactivated int)
language plpgsql
security definer
set search_path = "mission-hq", public
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'sync_slack_accounts: refusing to replace the snapshot with an empty list';
  end if;

  delete from "mission-hq".slack_accounts;

  insert into "mission-hq".slack_accounts
    (slack_user_id, email, display_name, is_bot, is_guest, deleted, synced_at)
  select
    r->>'id',
    lower(nullif(r->>'email', '')),
    nullif(r->>'name', ''),
    coalesce((r->>'is_bot')::boolean, false),
    coalesce((r->>'is_guest')::boolean, false),
    coalesce((r->>'deleted')::boolean, false),
    now()
  from jsonb_array_elements(p_rows) r
  where r->>'id' is not null
  on conflict (slack_user_id) do nothing;

  return query
    select count(*)::int,
           count(*) filter (where not is_bot and not is_guest and not deleted)::int,
           count(*) filter (where is_guest)::int,
           count(*) filter (where is_bot)::int,
           count(*) filter (where deleted)::int
      from "mission-hq".slack_accounts;
end $$;

grant execute on function "mission-hq".sync_slack_accounts(jsonb) to service_role;
grant select on "mission-hq".slack_accounts to service_role;
