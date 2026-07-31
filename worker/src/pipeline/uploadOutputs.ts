import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.js";

/**
 * Uploads a rendered file to the public `clips` bucket and returns its CDN
 * URL — downloads/thumbnails are served straight from Supabase Storage's
 * CDN, never routed back through the Next.js/API server.
 */
export async function uploadClipAsset(
  supabase: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  localPath: string,
  fileName: string,
  contentType: string,
): Promise<string> {
  const bytes = await readFile(localPath);
  const objectPath = `${userId}/${jobId}/${fileName}`;

  const { error } = await supabase.storage.from("clips").upload(objectPath, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to upload ${fileName} to clips bucket: ${error.message}`);
  }

  const { data } = supabase.storage.from("clips").getPublicUrl(objectPath);
  return data.publicUrl;
}
