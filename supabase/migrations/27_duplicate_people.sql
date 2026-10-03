-- ===========================================================================
-- One person, one row. Three people currently have two.
--
-- Somebody whose Slack address differs from their Zoho address ends up with a
-- row under each: one created by the mirror from `public.employees`, one added
-- so they could actually be prompted. Both are "active", so both are counted.
-- They are ranked TWICE in the fortnightly report, they inflate the group
-- headcount, and the row with no Slack account is alerted as unreachable every
-- single morning.
--
-- Deleting the duplicate does not work: the mirror trigger recreates it from
-- the Zoho feed on the next sync. So the Zoho-address row is marked exempt
-- instead, which every consumer already honours, and its `emp_id` is copied to
-- the row that can actually be messaged — `emp_id` is what the leave sync and
-- the Zoho attendance push match on, so the surviving row needs it.
--
-- Matched on normalised name AND a shared Slack account, rather than on name
-- alone: two different people can share a name, and merging them would be worse
-- than leaving a duplicate.
-- ===========================================================================

-- Give the reachable row the Zoho employee id from its twin.
update "mission-hq".employees keep
   set emp_id = dup.emp_id,
       updated_at = now()
  from "mission-hq".employees dup
 where "mission-hq".norm_(keep.full_name) = "mission-hq".norm_(dup.full_name)
   and keep.email <> dup.email
   and (keep.emp_id is null or keep.emp_id = '')
   and dup.emp_id is not null
   and exists (select 1 from public.identity_links il where lower(il.email) = keep.email)
   and not exists (select 1 from public.identity_links il where lower(il.email) = dup.email);

-- Retire the unreachable twin.
update "mission-hq".employees dup
   set wfo_exempt = 'Duplicate record: this person is tracked under their Slack address',
       updated_at = now()
  from "mission-hq".employees keep
 where "mission-hq".norm_(keep.full_name) = "mission-hq".norm_(dup.full_name)
   and keep.email <> dup.email
   and dup.wfo_exempt is null
   and exists (select 1 from public.identity_links il where lower(il.email) = keep.email)
   and not exists (select 1 from public.identity_links il where lower(il.email) = dup.email);

select full_name, email, emp_id, wfo_exempt is not null as retired
  from "mission-hq".employees
 where "mission-hq".norm_(full_name) in (
   select "mission-hq".norm_(full_name) from "mission-hq".employees
    group by "mission-hq".norm_(full_name) having count(*) > 1)
 order by full_name, email;
