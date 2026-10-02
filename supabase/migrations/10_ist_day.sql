-- ===========================================================================
-- One definition of "today", and it is the Indian one.
--
-- The views gated on `current_date`, which Postgres evaluates in the DATABASE
-- timezone (UTC here). The edge functions compute today in IST. Between 18:30
-- UTC and midnight — which is after midnight in India — those two disagree by a
-- day: the function asks about tomorrow while the view still answers about
-- yesterday.
--
-- It is harmless at the hours the crons actually fire (03:30 and 04:30 UTC,
-- where the UTC and IST dates coincide), which is exactly what makes it worth
-- fixing now rather than later: nothing is broken today, and the first person to
-- schedule a job at a different hour would inherit a bug that only appears
-- after 18:30 and reads as data randomly going missing.
--
-- `today_ist()` is now the single answer. Every job, view and query should use
-- it rather than `current_date`.
-- ===========================================================================

create or replace function "mission-hq".today_ist()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

comment on function "mission-hq".today_ist() is
  'Today in IST. Use this, never current_date — the database runs in UTC and '
  'the two differ after 18:30 UTC, which is after midnight in India.';

create or replace view "mission-hq".prompt_recipients as
  select
    e.email,
    e.full_name,
    e.team,
    e.location,
    il.slack_user_id
  from "mission-hq".employees e
  left join public.identity_links il
    on lower(il.email) = e.email
 where (e.exited_at is null or e.prompt_opt_in)
   and e.wfo_exempt is null
   and "mission-hq".is_business_day("mission-hq".today_ist())
   and not exists (
         select 1
           from "mission-hq".attendance a
          where a.email = e.email
            and a.day = "mission-hq".today_ist()
       );

create or replace view "mission-hq".prompt_gaps as
  select * from "mission-hq".prompt_recipients;

grant select on "mission-hq".prompt_recipients to service_role;
grant select on "mission-hq".prompt_gaps       to service_role;
grant execute on function "mission-hq".today_ist() to service_role;
