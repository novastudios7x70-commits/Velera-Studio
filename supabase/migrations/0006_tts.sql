-- Text-to-speech source path: instead of uploading a recording, a user can
-- type a script and have the worker generate a voiceover (ElevenLabs) before
-- running the exact same downstream pipeline (transcription, segment
-- selection, cutting, captioning) as any other spoken-content upload.
-- file_url has to become nullable — there's no pre-existing file to upload
-- for a TTS job, the worker generates and re-hosts the audio itself.
alter table uploads alter column file_url drop not null;
alter table uploads add column audio_source text not null default 'upload' check (audio_source in ('upload', 'tts'));
alter table uploads add column script_text text;
alter table uploads add column tts_voice_id text;

alter table uploads add constraint uploads_source_consistency check (
  (audio_source = 'upload' and file_url is not null)
  or
  (audio_source = 'tts' and script_text is not null and tts_voice_id is not null)
);

-- New status for the voiceover-generation step, matching the existing
-- generating_visuals pattern — Postgres's default name for a single-column
-- inline CHECK is "{table}_{column}_check".
alter table jobs drop constraint jobs_status_check;
alter table jobs add constraint jobs_status_check check (status in (
  'queued', 'generating_voiceover', 'analyzing', 'generating_visuals',
  'selecting', 'cutting', 'captioning', 'done', 'failed'
));
