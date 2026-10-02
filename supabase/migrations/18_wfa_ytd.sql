-- ===========================================================================
-- Expose year-to-date WFA, so the report can name who has used up the
-- entitlement.
--
-- The published report carried a line reading
--   "WFA annual cap (10/yr) reached: Kalanithi J P (47)"
-- and the number in brackets is the person's YTD WFA days, not this period's.
-- The metrics function computed it internally to apply the cap and then threw
-- it away.
--
-- Note the "(10/yr)" in that line was already WRONG when it was sent: PnC
-- raised the cap to 15 on 2026-08-21 and the message still said 10, because the
-- number was written into the sentence rather than read from the constant. The
-- renderer takes it from `settings` for exactly that reason.
--
-- The return type changes, so this drops and recreates rather than replaces.
-- ===========================================================================

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
  period as (
    select a.email, a.day, a.status, l.w_wfo, l.w_wfh, l.w_wfa, l.w_leave
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
     where a.day >= date_trunc('year', p_to)::date and a.day <= p_to
     group by a.email
  ),
  calc as (
    select g.email, e.full_name, g.wfo, g.wfh, g.wfa, g.leave, g.pending,
           g.prompted, g.wfh_wed, g.wfh_off_wed,
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
           (s.wfo + s.wfh_wed)                      as adherent,
           s.wfh_off_wed
      from split s
  )
  select
    f.email, f.full_name, f.wfo, f.wfh, f.wfa, f.wfa_over_cap, f.wfa_ytd,
    f.leave, f.pending, f.prompted, f.available, f.checked_in, f.adherent, f.wfh_off_wed,
    case when f.available > 0 then round(f.adherent   / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.wfo        / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.checked_in / f.available * 100)::int else 0 end,
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
    f.available desc, f.full_name;
$$;

grant execute on function "mission-hq".member_metrics(date, date) to service_role;
