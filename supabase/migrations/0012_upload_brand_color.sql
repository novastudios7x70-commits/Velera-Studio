-- Snapshots the uploading user's brand accent color onto the upload row at
-- job-creation time, same pattern as beat_sync_enabled/visual_style/
-- mood_description — a per-job customization is copied once at creation
-- rather than read live from profiles during rendering, so a user changing
-- their brand color later never changes an already-in-flight or already-
-- rendered job's output out from under them.
alter table uploads add column brand_color text;
