-- 50 — split the 40-point band, and take the numbers out of the headings.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM
-- ---------------------------------------------------------------------------
--
-- Below the two day-count tiers, everybody who was not at the standard fell
-- into one band:
--
--   B   60-99%   "Good progress, 60%+ but short of the standard"
--   C   1-59%    "Needs attention, below 60%"
--
-- So the published G&A snapshot printed a member at 90% under a heading saying
-- 60%+, three rows above somebody at 63%. The arithmetic was right both times.
-- The heading was what made it read wrong, and it is the single thing a
-- manager queried about this report: not the score, the category.
--
-- A band forty points wide describes nobody in it. 90% and 63% are not the
-- same situation and should not share a sentence, and a heading that leads
-- with its own floor tells the person at the top of the band the worst true
-- thing about their position.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES
-- ---------------------------------------------------------------------------
--
--   S   every available day in the office            exceeding
--   A   office + the weekly WFH day, every day       MEETING, the standard
--   B   80-99%                                       just short
--   C   60-79%                                       some way short
--   D   1-59%                                        needs attention
--   E   0%                                           check-in not active
--   X   available = 0                                not ranked
--
-- S and A are unchanged and are still DAY COUNTS, not percentages (13). The
-- split is in what used to be B, at 80 — four days of five, so the band
-- boundary is the same shape as the standard itself rather than a round number
-- chosen for being round.
--
-- 'D' MOVES. It was 0% and is now 1-59%; 0% becomes 'E'. The renderer is the
-- only reader of these letters and changes in the same commit. Nothing stores
-- a tier, so there is no historical data to migrate -- tiers are computed per
-- period, every time.
--
-- NO PERCENTAGE APPEARS IN ANY HEADING any more, here or in the renderer. The
-- number is already on every row, four columns wide, next to a bar. Repeating
-- the floor of the band in the heading added nothing and framed everybody in
-- the band by its worst member.
--
-- NON-DESTRUCTIVE: one function body, same return type, so this replaces
-- rather than drops. No table, no column, no data.

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
       and "mission-hq".is_business_day(a.day)          -- 48
  ),
  -- The WFH allowance is granted per calendar week (49), so it is capped per
  -- calendar week before anything is summed over the period.
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
      sum(least(w.wfh, 1))          as wfh_allowed,
      sum(greatest(w.wfh - 1, 0))   as wfh_excess
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
    -- THE TOP TWO ARE DAY COUNTS, the rest are percentage bands. Halves make
    -- the counters fractional, so S and A compare with a tolerance rather than
    -- equality. 80 is four days of five, the same shape as the standard.
    case
      when f.available <= 0                            then 'X'
      when abs(f.wfo      - f.available) < 0.01        then 'S'
      when abs(f.adherent - f.available) < 0.01        then 'A'
      when round(f.adherent / f.available * 100) >= 80 then 'B'
      when round(f.adherent / f.available * 100) >= 60 then 'C'
      when round(f.adherent / f.available * 100) >= 1  then 'D'
      else 'E'
    end
  from final f
  order by
    case when f.available > 0 then round(f.adherent / f.available * 100) else -1 end desc,
    case when f.available > 0 then round(f.checked_in / f.available * 100) else -1 end desc,
    f.available desc, f.full_name;
$$;

comment on function "mission-hq".member_metrics(date, date) is
  'Per-person attendance arithmetic for a period, over business days only (48). '
  'The WFH allowance is ONE DAY PER CALENDAR WEEK on any weekday (49). Tiers '
  '(50): S exceeding, A meeting the standard, B 80-99, C 60-79, D 1-59, '
  'E nothing, X available = 0 and so not ranked. S and A are day counts, not '
  'percentages.';

grant execute on function "mission-hq".member_metrics(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--
-- Nobody at 80 or above may share a band with somebody below it:
--
--   select tier, min(standard_pct) lo, max(standard_pct) hi, count(*)
--     from "mission-hq".member_metrics('2026-10-01','2026-10-15')
--    group by tier order by tier;
--   -- B must not dip below 80; C must sit inside 60..79; D inside 1..59.
--
-- The members who prompted this, at 90%, must now be in B and not beside a 63%:
--
--   select full_name, standard_pct, tier
--     from "mission-hq".member_metrics('2026-10-01','2026-10-15')
--    where standard_pct between 60 and 99 order by standard_pct desc;
