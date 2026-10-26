-- ===========================================================================
-- A third permission: managing who has access, without editing records.
--
-- Until now the only way to add or change an admin was to be an editor, and an
-- editor can also correct anybody's attendance. Somebody who runs the tool for
-- PnC needs the first without the second: being able to rewrite 350 people's
-- records just to hand out read access is more power than the job needs.
--
-- `can_manage_access` is independent of `can_edit`, not a third value on it:
-- a viewer can manage access, and so can an editor. Editors keep managing
-- access as before, so the "at least one editor must remain" rule still
-- guarantees somebody can always let people in.
-- ===========================================================================

alter table "mission-hq".dashboard_access
  add column if not exists can_manage_access boolean not null default false;

comment on column "mission-hq".dashboard_access.can_manage_access is
  'May add, change and remove admins. Independent of can_edit; editors may too.';
