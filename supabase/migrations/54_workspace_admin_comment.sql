-- ===========================================================================
-- Correct the column comment from migration 53.
--
-- 53 said a workspace admin may "add, change and remove admins". Review of the
-- same PR narrowed that before it shipped: giving or taking away editing stays
-- with editors, so a workspace admin cannot promote themselves or demote an
-- editor. The comment is what somebody reads in the table editor, so it should
-- say what the code enforces. Comment only; no data changes.
-- ===========================================================================

comment on column "mission-hq".dashboard_access.can_manage_access is
  'May add and remove viewers and set other workspace admins. Independent of can_edit. Giving or taking away editing stays with editors, who may also manage access.';
