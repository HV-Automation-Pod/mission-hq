-- 45 — is_business_day must read `holidays.counts`, not merely `holidays.day`.
--
-- ---------------------------------------------------------------------------
-- THE BUG
-- ---------------------------------------------------------------------------
--
-- 02 defined it as:
--
--   select extract(isodow from d) < 6
--      and not exists (select 1 from public.holidays h where h.day = d);
--
-- Correct about weekends, and wrong about half the holiday table. `public.holidays`
-- carries TWO columns of meaning, and 02 read only one of them:
--
--   classification   what Zoho calls the day, verbatim. Display only.
--   counts           whether the day actually stops the clock. Decided ONCE, at
--                    sync time, from Zoho's own `isRestrictedHoliday` boolean.
--
-- A RESTRICTED holiday is optional and taken per person, so most of the team is
-- at work. WeCare stores them deliberately — dropping them made its admin
-- screen show 12 days where Zoho lists 22, and a missing row reads as a broken
-- sync — and then never counts them. Reading `h.day` alone counts them.
--
-- ---------------------------------------------------------------------------
-- WHAT THAT ACTUALLY DID, WHICH IS NOT A ROUNDING ERROR
-- ---------------------------------------------------------------------------
--
-- Six things filter on this function: `prompt_recipients` (08),
-- `prompt_gaps` (08), `reminder_recipients` (11), the 10_ist_day verify view,
-- the dashboard payload (33) and `mission-hq-leave`. So on each of the ~10
-- restricted days a year, every one of them agreed that nobody was at work:
--
--   * no attendance prompt went out, to anybody;
--   * no reminder went out;
--   * the day left the denominator entirely, so it never showed as a gap.
--
-- A whole working day of attendance, missing, with nothing failing anywhere —
-- and the shape that makes it invisible is that the function was RIGHT about
-- every other day of the year. Nobody reports "the prompt did not arrive" on a
-- day half the office treats as a holiday.
--
-- The error only ever went one way: more non-working days than there really
-- are. Never a prompt on a day the office was shut.
--
-- ---------------------------------------------------------------------------
-- A NEW FILE, NOT AN EDIT TO 02
-- ---------------------------------------------------------------------------
--
-- Migrations are forward-only history. 02 keeps its original SQL and its
-- comment, which read correctly for what was known then; this file is last in
-- every ordering — fresh install, production, and re-run — which is the one
-- property that matters. `create or replace` is last-writer-wins and says
-- nothing, so the fix has to be the LAST definition rather than a corrected
-- earlier one.
--
-- 02 is now the first of two files defining this function. If a third ever
-- appears, it carries the whole body again — never an edit to either.
--
-- NON-DESTRUCTIVE: one function body. No table, no column, no data.

create or replace function "mission-hq".is_business_day(d date)
returns boolean
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  select extract(isodow from d) < 6
     and not exists (
       -- `h.counts`, NEVER `h.classification`. The label is what a UI renders
       -- and what a rename would change: `= 'Holiday'` looks exact and fails on
       -- "Holiday " with a space, on "holiday", and on "Company Holiday", every
       -- time in the direction that counts a closed day as a working one. The
       -- flag is the column the meaning lives in, decided once at sync time.
       select 1 from public.holidays h where h.day = d and h.counts
     );
$$;

comment on function "mission-hq".is_business_day(date) is
  'Mon-Fri and not a COUNTED holiday in public.holidays. The single answer to '
  '"does this day count" -- do not reimplement it in a caller. Restricted '
  'holidays are stored in that table and deliberately do not count: they are '
  'optional and taken per person, so most of the team is at work.';

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--
-- The split the function now respects:
--
--   select classification, counts, count(*)
--   from public.holidays group by 1, 2 order by 1;
--
-- Every restricted day must now be a business day when it falls Mon-Fri. This
-- returns the days whose answer this migration CHANGED, and it should list
-- exactly the weekday restricted holidays:
--
--   select h.day, h.name, h.classification,
--          "mission-hq".is_business_day(h.day) as now_a_business_day
--   from public.holidays h
--   where not h.counts and extract(isodow from h.day) < 6
--   order by h.day;
--
-- And nothing that COUNTS may be a business day:
--
--   select h.day, h.name from public.holidays h
--   where h.counts and "mission-hq".is_business_day(h.day);   -- expect 0 rows
--
-- No consumer changes. All six read the function rather than the table, which
-- is what makes this a one-file fix.
