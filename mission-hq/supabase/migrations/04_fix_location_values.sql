-- ===========================================================================
-- `locations.value` has to be what Slack actually sends, and it was not.
--
-- The option values in a Slack select are built by replacing whitespace with
-- hyphens (`item.value.replace(/\s+/g, "-")`, in both the Apps Script prompt
-- builder and the edge function's picker). Apps Script then reversed it on the
-- way into the sheet with `formatLocationValueForSheet_`: hyphens back to
-- spaces, plus one special case, `Office-Client` -> `Office + Client`.
--
-- 02 seeded this table with the SPACED form in `value`. Nothing had read it yet,
-- so nothing broke — but the moment the edge function started resolving a
-- payload against it, every multi-word answer would have missed: somebody
-- picking "Split Day" sends `Split-Day`, which matches no row, and the write
-- either fails or stores a wrong status.
--
-- After this, the round trip is one lookup with no string surgery anywhere:
--
--   Slack sends      value   'Office-Client'
--   we store         status  'Office + Client'
--
-- Single-word options are unchanged by the transform, so only the five
-- multi-word rows actually move.
-- ===========================================================================

update "mission-hq".locations set value = 'Client-Location'       where value = 'Client Location';
update "mission-hq".locations set value = 'Split-Day'             where value = 'Split Day';
update "mission-hq".locations set value = 'Compensatory-WFH'      where value = 'Compensatory WFH';
update "mission-hq".locations set value = 'Half-Day-Office-Leave' where value = 'Half Day Office Leave';
update "mission-hq".locations set value = 'Half-Day-WFH-Leave'    where value = 'Half Day WFH Leave';

-- 'Office-Client' was already hyphenated in 02 and is the one option whose
-- stored form is not just its value with the hyphens removed.

comment on column "mission-hq".locations.value is
  'EXACTLY what Slack sends in the interaction payload — whitespace replaced '
  'with hyphens by the picker that built the option. Match on this, never on '
  'the label.';

-- Prove it: every value must round-trip to its status by the old rule, so a
-- future edit to this table cannot quietly reintroduce the mismatch.
do $$
declare bad text;
begin
  select string_agg(value || ' -> ' || status, ', ')
    into bad
    from "mission-hq".locations
   where status <> case when value = 'Office-Client' then 'Office + Client'
                        else replace(value, '-', ' ') end;
  if bad is not null then
    raise exception 'locations value/status mismatch: %', bad;
  end if;
end $$;
