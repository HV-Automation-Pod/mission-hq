-- ===========================================================================
-- The arithmetic behind the fortnightly report, as one function.
--
-- These definitions are established and were got wrong twice before settling.
-- Do not "improve" them casually; each line below is a decision somebody made
-- for a reason that is written down.
--
--   prompted    days we actually asked about. A MISSING ROW is "never asked" and
--               leaves the denominator; a row saying 'Pending' is "asked and
--               ignored" and stays in it. Conflating the two is what dragged a
--               whole group to the bottom of a published ranking.
--   available   prompted - leave - WFA within entitlement
--   adherent    office days + WFH that fell on a WEDNESDAY
--   standard    adherent / available        <- the ranking metric
--
-- WEDNESDAY WFH COUNTS IN FULL. Wednesday is the default WFH day, not a day
-- off, so a Wednesday at home is the policy working as designed and scores like
-- an office day: four office days plus a Wednesday at home is 100%, not 80%.
-- WFH on any other weekday is the miss — it stays in the denominator and out of
-- the numerator. No carve-outs: the WFH half of a Split Day is judged by its
-- weekday like any other WFH, because one rule is what makes this explainable
-- to the person it is being applied to.
--
-- THE WFA CAP IS CONSUMED OLDEST-FIRST. Days earlier in the year eat the
-- allowance before this period does, so a heavy user has none left by the time
-- the period runs. Within entitlement is neutral like leave; over cap stays in
-- the denominator and counts as a check-in but not as office.
--
-- The cap lives in `settings`, not in this file. It has already moved once
-- (10 -> 15, PnC, 2026-08-21) and that should not be a migration.
-- ===========================================================================

insert into "mission-hq".settings (key, value) values
  ('wfa_annual_cap', '15'::jsonb)
on conflict (key) do nothing;

create or replace function "mission-hq".member_metrics(p_from date, p_to date)
returns table (
  email        text,
  full_name    text,
  wfo          numeric,
  wfh          numeric,
  wfa          numeric,
  wfa_over_cap numeric,
  leave        numeric,
  pending      numeric,
  prompted     numeric,
  available    numeric,
  checked_in   numeric,
  adherent     numeric,
  wfh_off_wed  numeric,
  standard_pct int,
  wfo_pct      int,
  ci_pct       int,
  tier         text
)
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  with cap as (
    select coalesce((select value #>> '{}' from "mission-hq".settings where key = 'wfa_annual_cap'), '15')::numeric n
  ),
  -- The days we asked about at all. In the spreadsheet this was "which date
  -- columns exist"; a day nobody was prompted on is not a day anybody can be
  -- marked down for.
  period as (
    select a.email, a.day, a.status,
           l.w_wfo, l.w_wfh, l.w_wfa, l.w_leave
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
     where a.day between p_from and p_to
  ),
  agg as (
    select
      p.email,
      sum(coalesce(p.w_wfo,   0)) as wfo,
      sum(coalesce(p.w_wfh,   0)) as wfh,
      sum(coalesce(p.w_wfa,   0)) as wfa,
      sum(coalesce(p.w_leave, 0)) as leave,
      -- 'Pending' has no weights row, and neither does a status the Locations
      -- list no longer carries. Both mean the same thing here: a day that
      -- cannot be credited as presence.
      sum(case when p.w_wfo is null then 1 else 0 end) as pending,
      sum(case when coalesce(p.w_wfh,0) > 0 and extract(isodow from p.day) = 3
               then p.w_wfh else 0 end) as wfh_wed,
      sum(case when coalesce(p.w_wfh,0) > 0 and extract(isodow from p.day) <> 3
               then p.w_wfh else 0 end) as wfh_off_wed,
      count(*)::numeric as prompted
    from period p
    group by p.email
  ),
  ytd as (
    select a.email, sum(coalesce(l.w_wfa, 0)) as wfa_ytd
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
     where a.day >= date_trunc('year', p_to)::date
       and a.day <= p_to
     group by a.email
  ),
  calc as (
    select
      g.email,
      e.full_name,
      g.wfo, g.wfh, g.wfa, g.leave, g.pending, g.prompted,
      g.wfh_wed, g.wfh_off_wed,
      -- Allowance already spent earlier in the year.
      greatest(0, coalesce(y.wfa_ytd, 0) - g.wfa) as prior_wfa,
      (select n from cap) as cap_n
    from agg g
    join "mission-hq".employees e on e.email = g.email
    left join ytd y on y.email = g.email
  ),
  split as (
    select c.*,
           least(c.wfa, greatest(0, c.cap_n - c.prior_wfa)) as wfa_within
      from calc c
  ),
  final as (
    select
      s.email, s.full_name, s.wfo, s.wfh, s.wfa,
      (s.wfa - s.wfa_within)                      as wfa_over_cap,
      s.leave, s.pending, s.prompted,
      (s.prompted - s.leave - s.wfa_within)       as available,
      (s.wfo + s.wfh + (s.wfa - s.wfa_within))    as checked_in,
      (s.wfo + s.wfh_wed)                         as adherent,
      s.wfh_off_wed
    from split s
  )
  select
    f.email,
    f.full_name,
    f.wfo, f.wfh, f.wfa, f.wfa_over_cap, f.leave, f.pending, f.prompted,
    f.available, f.checked_in, f.adherent, f.wfh_off_wed,
    case when f.available > 0 then round(f.adherent   / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.wfo        / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.checked_in / f.available * 100)::int else 0 end,
    -- THE TOP TWO TIERS ARE DAY COUNTS, NOT PERCENTAGES. "Exceeding" is every
    -- available day in the office; "Meeting" is every available day either in
    -- the office or a WFH Wednesday. A percentage cannot express that — 90% is
    -- Exceeding if it is 9 office days out of 9, and only Meeting if the tenth
    -- was a Wednesday at home. Halves make these fractional, so compare with a
    -- tolerance rather than equality.
    case
      when f.available <= 0                            then 'X'
      when abs(f.wfo      - f.available) < 0.01        then 'S'
      when abs(f.adherent - f.available) < 0.01        then 'A'
      when f.available > 0
       and round(f.adherent / f.available * 100) >= 60 then 'B'
      when round(f.adherent / f.available * 100) >= 1  then 'C'
      else 'D'
    end
  from final f
  order by
    case when f.available > 0 then round(f.adherent / f.available * 100) else -1 end desc,
    case when f.available > 0 then round(f.checked_in / f.available * 100) else -1 end desc,
    f.available desc,
    f.full_name;
$$;

comment on function "mission-hq".member_metrics(date, date) is
  'Per-person attendance arithmetic for a period. Tier X means available = 0 '
  '(on leave the whole period) — those are listed separately, never ranked at '
  '0% as if they had ignored the bot.';

grant execute on function "mission-hq".member_metrics(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- The six groups, and who is in them.
--
-- Channel ids and bot display names are DATA. Keep the names period-neutral:
-- the 1st reports a half-month and so does the 16th, so "Fortnightly" in a
-- name would be wrong on one of the two runs.
-- ---------------------------------------------------------------------------
insert into "mission-hq".summary_groups
  (key, name, channel_id, bot_username, match_kind, match_column, match_values, sort_order) values
  ('coimbatore','Coimbatore','C046Y1LKZLG','Coimbatore Attendance Summary','column','location',array['Coimbatore'], 1),
  ('flg',       'FLG',       'C07R3JUEL86','FLG Attendance Summary',       'roster',null,      null,                2),
  ('mumbai',    'Mumbai',    'C07CGSQF42U','Mumbai Attendance Summary',    'column','location',array['Mumbai'],     3),
  ('bengaluru', 'Bengaluru', 'C08K2HXPCRG','Bengaluru Attendance Summary', 'column','location',array['Bengaluru'],  4),
  ('gna',       'G&A',       'C0331D6JE2D','G&A Attendance Summary',       'column','team',
     array['People & Culture','Finance','Legal','Admin'], 5),
  ('managers',  'Managers',  'C061H34DECA','Managers Attendance Summary',  'roster',null,      null,                6)
on conflict (key) do update set
  name = excluded.name, channel_id = excluded.channel_id,
  bot_username = excluded.bot_username, match_kind = excluded.match_kind,
  match_column = excluded.match_column, match_values = excluded.match_values,
  sort_order = excluded.sort_order;

-- Normalised comparison, so 'People & Culture' matches 'people&culture'.
create or replace function "mission-hq".norm_(t text)
returns text language sql immutable as
$$ select lower(regexp_replace(coalesce(t,''), '[^a-zA-Z0-9&+]+', '', 'g')) $$;

-- ---------------------------------------------------------------------------
-- group_members
--
-- A COLUMN CELL CAN NAME MORE THAN ONE GROUP. A team of "Finance, FLG" belongs
-- to both, so the cell is split on commas before matching rather than compared
-- whole — comparing whole is how somebody in two groups appears in neither.
-- ---------------------------------------------------------------------------
create or replace view "mission-hq".group_members as
  select g.key as group_key, e.email
    from "mission-hq".summary_groups g
    join "mission-hq".employees e
      on g.match_kind = 'column'
     and exists (
           select 1
             from unnest(string_to_array(
                    case g.match_column when 'team' then e.team else e.location end, ',')) tok
             join unnest(g.match_values) v
               on "mission-hq".norm_(tok) = "mission-hq".norm_(v)
         )
   where g.active
  union
  select r.group_key, r.email
    from "mission-hq".rosters r
    join "mission-hq".summary_groups g on g.key = r.group_key and g.active
    join "mission-hq".employees e on e.email = r.email;

comment on view "mission-hq".group_members is
  'Roster rows are joined to employees deliberately: an email on a hand-kept '
  'list with no employee row cannot be scored, and silently dropping it is how '
  'a group reports short. Compare counts with the roster to see the gap.';

grant select on "mission-hq".group_members to service_role;
grant execute on function "mission-hq".norm_(text) to service_role;
