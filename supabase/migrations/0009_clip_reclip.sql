-- Editable timestamps -> re-render: tracks whether a clip currently has a
-- re-render in flight, so Review can show a processing state instead of the
-- old clip looking idle while a new file renders in the background. Set
-- when a re-render starts, cleared by the worker's reclip phase on both
-- success and failure — never left stuck set.
alter table clips add column render_started_at timestamptz;
