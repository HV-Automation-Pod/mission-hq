-- ===========================================================================
-- Take the em dashes out of stored data, not just out of new output.
--
-- `wfo_exempt` holds a REASON a human reads, and the offboarding sweep wrote it
-- as "Exited — not in Zoho org tree + Slack account deactivated (2026-09-17)".
-- The rule is no em dashes in anything a person sees through the product, and
-- these rows are data the dashboard renders, so they count.
--
-- Only the separator changes. The reason itself is evidence of why somebody was
-- taken out of the daily prompt and must survive intact.
-- ===========================================================================

update "mission-hq".employees
   set wfo_exempt = replace(wfo_exempt, 'Exited — ', 'Exited: '),
       updated_at = now()
 where wfo_exempt like 'Exited — %';

update "mission-hq".employees
   set wfo_exempt = replace(wfo_exempt, ' — ', ', '),
       updated_at = now()
 where wfo_exempt like '% — %';

-- Nothing user-facing should carry one. Fails loudly rather than leaving a
-- half-done cleanup that reads as finished.
do $$
declare n int;
begin
  select count(*) into n from "mission-hq".employees where wfo_exempt like '%—%';
  if n > 0 then raise exception 'still % wfo_exempt value(s) with an em dash', n; end if;
end $$;
