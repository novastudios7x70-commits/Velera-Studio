-- Storage buckets for raw uploads and rendered clip output.
-- Convention: objects are stored under `${auth.uid()}/...` so a single storage
-- policy can enforce per-user ownership via the folder prefix.

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('clips', 'clips', true)
on conflict (id) do nothing;

-- uploads bucket: private, owner-only read/write (raw user media, never served directly to other users)
create policy "uploads: owner read"
  on storage.objects for select
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads: owner write"
  on storage.objects for insert
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads: owner delete"
  on storage.objects for delete
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- clips bucket: public read (served straight from Supabase Storage's CDN for
-- downloads/thumbnails per the scalability requirement), owner-only write.
-- Writes happen from the worker using the service role key, which bypasses RLS,
-- so this policy only needs to cover the (rare) client-side case.
create policy "clips: public read"
  on storage.objects for select
  using (bucket_id = 'clips');

create policy "clips: owner write"
  on storage.objects for insert
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
