-- The `clips` storage bucket previously only had "public read" and "owner
-- write" policies (see 0002_storage.sql) — writes happen from the worker
-- using the service-role key, which bypasses RLS, so a delete policy was
-- never needed for that path. Project deletion from the dashboard needs the
-- *user's own* session to remove their rendered clip files directly, so add
-- the missing owner-delete policy, mirroring the existing "uploads: owner
-- delete" policy and the `${userId}/${jobId}/${fileName}` object-path
-- convention from worker/src/pipeline/uploadOutputs.ts.
create policy "clips: owner delete"
  on storage.objects for delete
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
