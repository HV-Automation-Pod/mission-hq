-- ===========================================================================
-- MissionHQ's own site label, because Zoho's is not the one the org uses.
--
-- The Zoho org tree knows six locations and Coimbatore is not among them — the
-- 22 people who work there are filed as Bengaluru. The spreadsheet carried the
-- correction, because the employee sync wrote `Location` only when the cell was
-- blank, so a hand-fixed value survived every subsequent run. That made the
-- sheet's column quietly more accurate than its source, and nothing recorded
-- that it was.
--
-- Migrating the Zoho value alone would have sent an EMPTY Coimbatore report and
-- folded those 22 into Bengaluru's ranking — both silently, both plausible
-- enough to go unnoticed for a fortnight.
--
-- So the override is a column MissionHQ owns and the mirror never touches,
-- exactly like `wfo_exempt`. `site` is what every group match reads; it falls
-- back to Zoho when nobody has corrected anything, so this stays empty for the
-- ~350 people whose Zoho location is already right.
-- ===========================================================================

alter table "mission-hq".employees
  add column if not exists location_override text;

comment on column "mission-hq".employees.location_override is
  'Set by hand when Zoho''s location is wrong for attendance-reporting purposes '
  '(Coimbatore, which Zoho files as Bengaluru). Never written by the mirror '
  'trigger. Null means Zoho''s value is correct.';

-- One place the answer comes from, so a group matcher cannot read the raw Zoho
-- column by accident.
create or replace function "mission-hq".site(e "mission-hq".employees)
returns text language sql immutable as
$$ select coalesce(nullif(trim(e.location_override), ''), e.location) $$;

comment on function "mission-hq".site("mission-hq".employees) is
  'The site to report against: the override if somebody set one, else Zoho.';

-- Rebuild group_members to match on `site` rather than the raw Zoho column.
create or replace view "mission-hq".group_members as
  select g.key as group_key, e.email
    from "mission-hq".summary_groups g
    join "mission-hq".employees e
      on g.match_kind = 'column'
     and exists (
           select 1
             from unnest(string_to_array(
                    case g.match_column
                      when 'team' then e.team
                      else "mission-hq".site(e)
                    end, ',')) tok
             join unnest(g.match_values) v
               on "mission-hq".norm_(tok) = "mission-hq".norm_(v)
         )
   where g.active
     -- Somebody who has left is not in a group. The metrics only cover people
     -- with rows in the period anyway, but a leaver with history would
     -- otherwise still be counted in "people in this group".
     and (e.exited_at is null or e.prompt_opt_in)
     and e.wfo_exempt is null
  union
  select r.group_key, r.email
    from "mission-hq".rosters r
    join "mission-hq".summary_groups g on g.key = r.group_key and g.active
    join "mission-hq".employees e on e.email = r.email
   where (e.exited_at is null or e.prompt_opt_in)
     and e.wfo_exempt is null;

grant select on "mission-hq".group_members to service_role;
grant execute on function "mission-hq".site("mission-hq".employees) to service_role;
