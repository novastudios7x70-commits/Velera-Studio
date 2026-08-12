-- Discover: the pipeline now pauses after segment selection instead of
-- rendering every LLM-selected moment automatically. jobs.selected_segments
-- already held the real candidate moments (see selectSegments.ts) — this
-- migration just adds the state needed to let a user act on that data
-- before the worker resumes into rendering.
alter table jobs drop constraint jobs_status_check;
alter table jobs add constraint jobs_status_check check (status in (
  'queued', 'generating_voiceover', 'analyzing', 'generating_visuals',
  'selecting', 'awaiting_selection', 'cutting', 'captioning', 'done', 'failed'
));

-- Indices into jobs.selected_segments the user chose to render. Null until
-- confirmed. "Let Velora choose for me" writes every index (the old
-- fully-automatic behavior); manual selection writes a subset.
alter table jobs add column confirmed_segment_indices smallint[];
