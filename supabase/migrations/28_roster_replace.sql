-- ===========================================================================
-- Replace a roster in one statement, and refuse to empty it.
--
-- The Managers roster is the member list of a Slack channel. Rebuilding it
-- means delete-then-insert, and the failure that matters is a transient Slack
-- error returning zero members: the delete succeeds, the insert has nothing to
-- add, and a group that had 57 people silently reports nobody. Apps Script hit
-- this and guarded against it; the guard belongs here now.
--
-- A roster that resolves to zero is always a bug, never an answer. There is no
-- legitimate case where a group's hand-kept membership becomes empty by itself.
-- ===========================================================================

create or replace function "mission-hq".replace_roster(p_group text, p_emails text[])
returns table (added int, removed int)
language plpgsql
security definer
set search_path = "mission-hq", public
as $$
declare
  a int;
  r int;
begin
  if p_emails is null or array_length(p_emails, 1) is null then
    raise exception 'refusing to empty the % roster: a roster that resolves to zero is a bug, not an answer', p_group;
  end if;

  with gone as (
    delete from "mission-hq".rosters ro
     where ro.group_key = p_group
       and not (ro.email = any(p_emails))
    returning 1
  )
  select count(*)::int into r from gone;

  with put as (
    insert into "mission-hq".rosters (group_key, email, source)
    select p_group, lower(e), 'slack' from unnest(p_emails) e
    on conflict (group_key, email) do update set updated_at = now()
    returning 1
  )
  select count(*)::int into a from put;

  return query select a, r;
end $$;

grant execute on function "mission-hq".replace_roster(text, text[]) to service_role;
