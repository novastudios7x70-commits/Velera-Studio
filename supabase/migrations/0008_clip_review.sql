-- Review/Approve/Edit Title/Export V1: clips need a review state before a
-- creator downloads them. Nullable timestamps rather than a status enum,
-- matching the existing downloaded_at/marked_posted_at convention on this
-- same table. Rejecting a clip only sets rejected_at (soft-hide) — it is
-- never deleted, in storage or in this table.
alter table clips add column approved_at timestamptz;
alter table clips add column rejected_at timestamptz;

-- A clip can't be both approved and rejected at once — approve/reject each
-- clear the other's timestamp (see /api/clips/[id]'s PATCH handler).
alter table clips add constraint clips_review_state_check
  check (approved_at is null or rejected_at is null);
