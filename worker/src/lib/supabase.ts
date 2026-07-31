import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

// The worker always runs with the service role key — it has no user session
// to bind to, and needs to write job/clip rows on behalf of whichever user
// owns the upload. This bypasses RLS entirely, which is why every write path
// in this package double-checks ownership explicitly rather than relying on
// policies the way the Next.js app does.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
