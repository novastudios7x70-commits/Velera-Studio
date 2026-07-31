// Supabase's getPublicUrl() bakes the full CDN URL into clips.file_url /
// clips.thumbnail_url (see worker/src/pipeline/uploadOutputs.ts). To remove
// the underlying object via storage.from(bucket).remove([...]) we need just
// the object path, so pull it back out of the `/object/public/<bucket>/`
// segment rather than assuming any particular host.
export function objectPathFromPublicUrl(bucket: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length));
  } catch {
    return null;
  }
}
