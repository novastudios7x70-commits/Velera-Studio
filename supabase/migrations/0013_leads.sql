-- Contact/Agency lead persistence. Previously a submission only ever
-- triggered a best-effort notification email (or nothing, if
-- CONTACT_NOTIFY_EMAIL/RESEND_API_KEY weren't set) — no durable record
-- existed anywhere, so a missed or failed email meant the lead was lost
-- with zero trace. No RLS policies: this table has no legitimate
-- client-side access in either direction (no user_id, no logged-in
-- actor) — it's written exclusively by POST /api/contact via the
-- service-role admin client, and read via the Supabase dashboard directly.
create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  email text not null,
  details text,
  created_at timestamptz not null default now()
);
alter table leads enable row level security;
