-- 49 — the WFH allowance is ONE DAY A WEEK, on any weekday, not Wednesday.
--
-- ---------------------------------------------------------------------------
-- WHAT THE POLICY ACTUALLY SAYS
-- ---------------------------------------------------------------------------
--
-- "HyperVerge Work From Office Policy, 4 Days/Week", effective per location
-- through 2026. Two clauses matter here and they have to be read together:
--
--   Predictability   "Default WFH day: Wednesday. Default WFO days: the
--                     remaining 4 working days."
--   Swap rule        "If a member is travelling or visiting a client on the
--                     fixed WFH day, that day is counted as WFO. The member may
--                     swap the WFH day that week with ANY OTHER DAY — with
--                     manager awareness and a Slack status update."
--
-- Wednesday is a DEFAULT, not the condition. The entitlement is one WFH day per
-- week; which weekday it lands on is a scheduling convention the policy itself
-- permits moving. 13 and 18 encoded the default as though it were the rule:
--
--   adherent = wfo + wfh_wed          -- Wednesday, or nothing
--
-- So somebody who swapped exactly as clause 10 of the FAQ invites them to
-- ("If you prefer Monday or Friday as a makeup WFH day, that is a reasonable
-- default") was scored as absent for a day the policy had already allowed.
-- That is not a rounding error, it is the report contradicting the document it
-- claims to enforce, and it is what a manager queried on the 1-15 October G&A
-- snapshot: a member at 90% whose single uncredited day was a Thursday at home.
--
-- AFTER:
--
--   adherent = wfo + least(wfh_in_that_week, 1)   summed over calendar weeks
--
-- Four days in the office out of five, with the fifth free to be at home on
-- whichever day the week required. A SECOND WFH day in the same week is the
-- miss, and it is a real one: it stays in the denominator and out of the
-- numerator exactly as an uncredited day always has.
--
-- ---------------------------------------------------------------------------
-- WHY PER WEEK, AND NOT A PERCENTAGE
-- ---------------------------------------------------------------------------
--
-- "80% of available days" was considered and is wrong, because the entitlement
-- the policy grants is weekly. The two differ precisely where it matters:
--
--   office Mon-Thu, home Fri, both weeks      8 office + 2 WFH of 10
--                                             weekly: 10/10, meets
--                                             80% rule: 80%, also meets
--
--   home Mon AND Tue one week, perfect next   8 office + 2 WFH of 10
--                                             weekly: 9/10, MISSES  <- correct
--                                             80% rule: 80%, meets   <- wrong
--
-- Both people took two WFH days. Only the first followed the policy. A
-- period-wide percentage cannot tell them apart; it lets somebody bank an
-- unused allowance from one week and spend two in the next, which is the
-- "rotating WFH days week-to-week" the policy explicitly asks teams to avoid.
--
-- Half days make the counters fractional, so the cap is `least(wfh, 1)` rather
-- than a count: two half-days at home in one week consume the whole allowance.
--
-- A week clipped by the period boundary (1-15 October ends on a Thursday) still
-- gets its own full allowance. That is deliberate and it is the lenient
-- direction: the fortnight is a reporting window, not a policy window, and
-- halving an allowance because a report ended mid-week would penalise somebody
-- for the calendar.
--
-- ---------------------------------------------------------------------------
-- wfh_off_wed IS REPLACED BY wfh_excess
-- ---------------------------------------------------------------------------
--
-- The old column answered "how much WFH was not on a Wednesday", which no
-- decision can use any more. The question that replaced it is "how much WFH
-- went beyond the weekly allowance", which is now the entire miss. The return
-- type changes, so this DROPS and recreates rather than replacing (42P13).
--
-- Callers updated in the same commit: the summary renderer and
-- `mission-hq/src/lib/policy.ts`, which is a deliberate mirror of this function.
--
-- NON-DESTRUCTIVE: one function. No table, no column, no data.

drop function if exists "mission-hq".member_metrics(date, date);

create or replace function "mission-hq".member_metrics(p_from date, p_to date)
returns table (
  email        text,
  full_name    text,
  wfo          numeric,
  wfh          numeric,
  wfa          numeric,
  wfa_over_cap numeric,
  wfa_ytd      numeric,
  leave        numeric,
  pending      numeric,
  prompted     numeric,
  available    numeric,
  checked_in   numeric,
  adherent     numeric,
  wfh_excess   numeric,
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
  period as (
    select a.email, a.day, a.status, l.w_wfo, l.w_wfh, l.w_wfa, l.w_leave
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
     where a.day between p_from and p_to
       -- 48. A row dated a weekend or a counted holiday is not a day anybody
       -- can be scored on, in either half of the fraction.
       and "mission-hq".is_business_day(a.day)
  ),
  -- THE WEEKLY STEP, and the whole point of this migration. The allowance is
  -- granted per calendar week, so it has to be capped per calendar week before
  -- anything is summed over the period. date_trunc('week') is Monday-based,
  -- which is the working week this policy describes.
  weekly as (
    select
      p.email,
      date_trunc('week', p.day) as wk,
      sum(coalesce(p.w_wfo,   0)) as wfo,
      sum(coalesce(p.w_wfh,   0)) as wfh,
      sum(coalesce(p.w_wfa,   0)) as wfa,
      sum(coalesce(p.w_leave, 0)) as leave,
      sum(case when p.w_wfo is null then 1 else 0 end) as pending,
      count(*)::numeric as prompted
    from period p
    group by p.email, date_trunc('week', p.day)
  ),
  agg as (
    select
      w.email,
      sum(w.wfo) as wfo, sum(w.wfh) as wfh, sum(w.wfa) as wfa,
      sum(w.leave) as leave, sum(w.pending) as pending, sum(w.prompted) as prompted,
      -- One day a week, whichever day it was.
      sum(least(w.wfh, 1)) as wfh_allowed,
      -- Everything past it. This is the miss.
      sum(greatest(w.wfh - 1, 0)) as wfh_excess
    from weekly w
    group by w.email
  ),
  ytd as (
    select a.email, sum(coalesce(l.w_wfa, 0)) as wfa_ytd
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
     where a.day >= date_trunc('year', p_to)::date and a.day <= p_to
       and "mission-hq".is_business_day(a.day)
     group by a.email
  ),
  calc as (
    select g.email, e.full_name, g.wfo, g.wfh, g.wfa, g.leave, g.pending,
           g.prompted, g.wfh_allowed, g.wfh_excess,
           coalesce(y.wfa_ytd, 0) as wfa_ytd,
           greatest(0, coalesce(y.wfa_ytd, 0) - g.wfa) as prior_wfa,
           (select n from cap) as cap_n
      from agg g
      join "mission-hq".employees e on e.email = g.email
      left join ytd y on y.email = g.email
  ),
  split as (
    select c.*, least(c.wfa, greatest(0, c.cap_n - c.prior_wfa)) as wfa_within from calc c
  ),
  final as (
    select s.email, s.full_name, s.wfo, s.wfh, s.wfa,
           (s.wfa - s.wfa_within)                   as wfa_over_cap,
           s.wfa_ytd, s.leave, s.pending, s.prompted,
           (s.prompted - s.leave - s.wfa_within)    as available,
           (s.wfo + s.wfh + (s.wfa - s.wfa_within)) as checked_in,
           -- THE CHANGE. Was `s.wfo + s.wfh_wed`.
           (s.wfo + s.wfh_allowed)                  as adherent,
           s.wfh_excess
      from split s
  )
  select
    f.email, f.full_name, f.wfo, f.wfh, f.wfa, f.wfa_over_cap, f.wfa_ytd,
    f.leave, f.pending, f.prompted, f.available, f.checked_in, f.adherent, f.wfh_excess,
    case when f.available > 0 then round(f.adherent   / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.wfo        / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.checked_in / f.available * 100)::int else 0 end,
    -- THE TOP TWO TIERS ARE DAY COUNTS, NOT PERCENTAGES, and that is unchanged
    -- from 13: "Exceeding" is every available day in the office, "Meeting" is
    -- every available day either in the office or within the weekly WFH
    -- allowance. A percentage cannot express that. Halves make these
    -- fractional, so compare with a tolerance rather than equality.
    case
      when f.available <= 0                            then 'X'
      when abs(f.wfo      - f.available) < 0.01        then 'S'
      when abs(f.adherent - f.available) < 0.01        then 'A'
      when round(f.adherent / f.available * 100) >= 60 then 'B'
      when round(f.adherent / f.available * 100) >= 1  then 'C'
      else 'D'
    end
  from final f
  order by
    case when f.available > 0 then round(f.adherent / f.available * 100) else -1 end desc,
    case when f.available > 0 then round(f.checked_in / f.available * 100) else -1 end desc,
    f.available desc, f.full_name;
$$;

comment on function "mission-hq".member_metrics(date, date) is
  'Per-person attendance arithmetic for a period, over business days only (48). '
  'The WFH allowance is ONE DAY PER CALENDAR WEEK on any weekday (49) -- '
  'Wednesday is the policy''s default, not its condition, and the swap rule '
  'permits any other day. WFH beyond one day in a week is wfh_excess and counts '
  'against adherence. Tier X means available = 0 (on leave the whole period); '
  'those are listed separately, never ranked at 0%.';

grant execute on function "mission-hq".member_metrics(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--
-- Murali Gurajapu, 1-15 October 2026. One WFH day, Thursday 1 October, which
-- is the only week-1 WFH day they took. It is now inside the allowance:
--
--   select wfo, wfh, wfh_excess, available, adherent, standard_pct, tier
--     from "mission-hq".member_metrics('2026-10-01','2026-10-15')
--    where email = 'murali.g@hyperverge.co';
--   -- expect wfo 9, wfh 1, excess 0, available 10, adherent 10, 100%, tier A
--
-- Nobody may have adherent above available, which would mean the allowance was
-- credited on a day that was not available:
--
--   select count(*) from "mission-hq".member_metrics('2026-10-01','2026-10-15')
--    where adherent > available + 0.01;              -- expect 0
--
-- Who the weekly cap actually bites, and by how much:
--
--   select full_name, wfh, wfh_excess, available, adherent, standard_pct, tier
--     from "mission-hq".member_metrics('2026-10-01','2026-10-15')
--    where wfh_excess > 0 order by wfh_excess desc;
