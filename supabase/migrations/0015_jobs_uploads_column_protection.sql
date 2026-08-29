-- Closes the same class of privilege-escalation hole as 0014, on jobs and
-- uploads: "own jobs"/"own uploads" (0001) only ever restricted *which row*
-- a user could touch (auth.uid() = user_id), never *which columns* — so an
-- authenticated client calling PostgREST directly could reassign their own
-- job's upload_id to point at another user's private upload, then drive it
-- through the real confirm-selection flow. The worker (service-role,
-- bypasses RLS) trusts jobs.upload_id completely with no cross-check against
-- the job's own user_id, so it will download and render whatever upload that
-- id points to.
--
-- Fix, same pattern as 0014: restrict authenticated's UPDATE grant to
-- exactly the columns each table's one legitimate client-facing write path
-- needs, and split "for all" into per-operation policies with explicit
-- WITH CHECK so INSERT/DELETE (never legitimately needed from the client on
-- either table) are no longer implicitly allowed.

-- jobs: the only client-facing UPDATE is POST /api/jobs/[id]/confirm-selection,
-- which sets exactly `status` and `confirmed_segment_indices`. Every other
-- column (upload_id, user_id, transcript, audio_analysis,
-- generated_visual_url, error_message, ...) is written only by the worker's
-- service-role client or by create_job()/apply_reclip() (SECURITY DEFINER,
-- unaffected by grants on the authenticated role).
revoke update on public.jobs from authenticated;
grant update (status, confirmed_segment_indices) on public.jobs to authenticated;

drop policy "own jobs" on public.jobs;

create policy "select own jobs" on public.jobs
  for select using (auth.uid() = user_id);

create policy "update own jobs" on public.jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- uploads: every column is set once at creation (POST /api/jobs inserts the
-- row) and never updated by any client-facing code afterward — even the TTS
-- voiceover re-host writes upload.file_url via the worker's service-role
-- client, not the user's session. So the client has no legitimate
-- post-creation UPDATE path at all; the grant is revoked outright rather
-- than narrowed to an allowlist.
revoke update on public.uploads from authenticated;

drop policy "own uploads" on public.uploads;

create policy "select own uploads" on public.uploads
  for select using (auth.uid() = user_id);

create policy "insert own uploads" on public.uploads
  for insert with check (auth.uid() = user_id);
