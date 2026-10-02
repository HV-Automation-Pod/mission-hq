-- ===========================================================================
-- The fortnightly summary, as data.
--
-- Apps Script held all of this as constants in a 1,600-line file: the day
-- weights, the six groups, the channel ids, the per-group scores from last
-- time, the snapshot numbers. Half of it is configuration somebody in PnC
-- should be able to change, and all of it needed a deploy.
--
-- Three things deliberately do NOT become new tables:
--   * day weights go on `locations`, because `locations.status` IS the stored
--     status — one table means the dropdown and the scoring cannot drift apart
--   * last scores and snapshot number go on `summary_groups` as columns, since
--     they are one row per group and nothing else will ever join to them
--   * "which period did we last send" is one key in `settings`
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Day weights — a day is NOT all-or-nothing
--
-- Half days split across two buckets and each status sums to 1. Counters are
-- therefore fractional, and day counts must be compared with a tolerance
-- rather than equality.
-- ---------------------------------------------------------------------------
alter table "mission-hq".locations
  add column if not exists w_wfo   numeric(3,2) not null default 0,
  add column if not exists w_wfh   numeric(3,2) not null default 0,
  add column if not exists w_wfa   numeric(3,2) not null default 0,
  add column if not exists w_leave numeric(3,2) not null default 0;

update "mission-hq".locations set w_wfo = 1                 where status in
  ('Office','Client Location','Travel','Office + Client','Compensatory WFH');
update "mission-hq".locations set w_wfh = 1                 where status = 'Home';
update "mission-hq".locations set w_wfa = 1                 where status = 'Anywhere';
update "mission-hq".locations set w_leave = 1               where status = 'Leave';
update "mission-hq".locations set w_wfo = 0.5, w_wfh = 0.5  where status = 'Split Day';
update "mission-hq".locations set w_wfo = 0.5, w_leave = 0.5 where status = 'Half Day Office Leave';
update "mission-hq".locations set w_wfh = 0.5, w_leave = 0.5 where status = 'Half Day WFH Leave';

comment on column "mission-hq".locations.w_wfo is
  'Compensatory WFH weighs as OFFICE: it is comp for weekend work, not a WFH '
  'choice. Office + Client, Client Location and Travel likewise.';

-- Every status must sum to exactly 1, or a day silently scores as a fraction
-- of itself. Checked rather than trusted, because the failure is invisible.
do $$
declare bad text;
begin
  select string_agg(status || ' = ' || (w_wfo + w_wfh + w_wfa + w_leave)::text, ', ')
    into bad from "mission-hq".locations
   where abs((w_wfo + w_wfh + w_wfa + w_leave) - 1) > 0.001;
  if bad is not null then raise exception 'day weights do not sum to 1: %', bad; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Groups
--
-- Two kinds of membership, because two different things are true:
--   'column' — derived from Zoho data, so it maintains itself
--   'roster' — a list somebody keeps by hand, because no Zoho field names it
--
-- FLG is not a Zoho department; its people sit across several. Managers is the
-- member list of its own Slack channel. Neither can be expressed as a column
-- match, and pretending otherwise is what once sent an FLG report with one
-- person in it.
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".summary_groups (
  key           text primary key,
  name          text not null,
  channel_id    text not null,
  bot_username  text not null,
  match_kind    text not null check (match_kind in ('column','roster')),
  match_column  text,
  match_values  text[],
  -- Carried from the last real send. Per-person percentages keyed by name, so
  -- the next report can show movement instead of a blank column.
  last_scores   jsonb  not null default '{}'::jsonb,
  last_period   text,
  -- Renders as "our sixth attendance snapshot".
  snapshot_no   int    not null default 0,
  active        boolean not null default true,
  sort_order    int    not null default 0
);

comment on column "mission-hq".summary_groups.last_scores is
  'Written only after a REAL send. Test and preview runs must not touch it, or '
  'previewing silently corrupts the next report''s deltas.';

-- ---------------------------------------------------------------------------
-- Rosters — the hand-kept lists
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".rosters (
  group_key  text not null references "mission-hq".summary_groups(key) on delete cascade,
  email      text not null,
  source     text not null default 'manual',
  updated_at timestamptz not null default now(),
  primary key (group_key, email)
);

comment on table "mission-hq".rosters is
  'Membership for groups no Zoho field can name. source=''slack'' rows are '
  'rebuilt from a channel; source=''manual'' rows are somebody''s list.';

alter table "mission-hq".summary_groups enable row level security;
alter table "mission-hq".rosters        enable row level security;
grant select, insert, update, delete on "mission-hq".summary_groups to service_role;
grant select, insert, update, delete on "mission-hq".rosters        to service_role;
