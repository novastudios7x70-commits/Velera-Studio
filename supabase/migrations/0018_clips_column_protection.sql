-- Close the clips RLS gap identified in the ownership audit: the original
-- "own clips" policy (0001_init.sql) only ever restricted *which row* a
-- client could touch (auth.uid() = user_id) — never which columns, and
-- never whether a client could INSERT at all. Same class of hole 0014/0015
-- already closed for profiles/jobs/uploads, applied here the same way.
--
-- The app never inserts clips client-side (only the worker, via
-- service_role, which bypasses RLS/grants entirely and is unaffected by
-- anything below) — so INSERT is dropped for authenticated outright rather
-- than narrowed. The only legitimate client-facing UPDATEs are
-- PATCH /api/clips/[id] (downloaded_at, marked_posted_at, approved_at,
-- rejected_at, title) and POST /api/clips/[id]/re-render (render_started_at,
-- render_failed_at) — both confirmed by inspection immediately before this
-- migration was written.
revoke insert, update on public.clips from authenticated;
grant update (
  downloaded_at,
  marked_posted_at,
  approved_at,
  rejected_at,
  title,
  render_started_at,
  render_failed_at
) on public.clips to authenticated;

-- Split the old catch-all "for all" policy into per-operation policies.
-- SELECT/DELETE behavior is unchanged (still auth.uid() = user_id). UPDATE
-- gets an explicit WITH CHECK — functionally already implied by Postgres
-- deriving WITH CHECK from USING when none is given for a FOR ALL policy
-- (empirically confirmed during the audit: a client cannot reassign
-- clips.user_id via UPDATE today), but made explicit here rather than
-- relying on that implicit behavior. No INSERT policy is created for
-- authenticated — with RLS enabled and no matching policy for a role, that
-- role's INSERT is denied outright, which is exactly what we want.
drop policy "own clips" on public.clips;

create policy "select own clips" on public.clips
  for select using (auth.uid() = user_id);

create policy "update own clips" on public.clips
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own clips" on public.clips
  for delete using (auth.uid() = user_id);
