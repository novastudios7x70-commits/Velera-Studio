// Single source of truth for which upload formats the pipeline supports,
// shared between the upload UI (client-side rejection before a file is even
// uploaded) and POST /api/jobs (server-side defense-in-depth — the client
// check is bypassable via drag-and-drop or a direct API call). WebM is
// deliberately not included: it's unsupported, not merely unlisted, and
// shouldn't be added without an explicit decision to support it.
export const ACCEPTED_UPLOAD_EXTENSIONS = [".mp4", ".mov", ".mp3", ".wav", ".m4a"];

export function hasAcceptedUploadExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
