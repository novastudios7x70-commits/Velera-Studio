-- Close a privilege-escalation hole: the "own profile" policy from 0001 only
-- restricted *which row* a user could touch (auth.uid() = id) — Postgres RLS
-- is row-granular, not column-granular — so nothing stopped an authenticated
-- client from calling PostgREST directly (bypassing the app entirely) to set
-- their own plan to 'agency', inflate clips_remaining/allowances, or fake
-- stripe_subscription_status. Every legitimate write to those fields already
-- goes through a SECURITY DEFINER function (create_job, claim_clip_credit,
-- refund_job_reservation) or the service-role webhook client, both of which
-- run as the table owner / service_role and bypass RLS and table grants
-- entirely — so this can be locked down with zero impact on any real path.
--
-- Fix: restrict which *columns* the authenticated role may UPDATE to exactly
-- the fields the client is actually meant to self-serve edit (Brand Kit
-- color, display name, the marketing-consent checkbox — see PATCH
-- /api/profile). Supabase grants authenticated broad table privileges by
-- default, so the revoke is required before the narrower grant takes effect.
revoke update on public.profiles from authenticated;
grant update (display_name, brand_color, marketing_email_consent) on public.profiles to authenticated;

-- Split the old catch-all "for all" policy into per-operation policies, so
-- INSERT/DELETE (never legitimately needed from the client — profiles are
-- created by handle_new_user()'s trigger and removed only via the auth.users
-- cascade) are no longer implicitly allowed, and add an explicit WITH CHECK
-- on UPDATE so a row can never be reassigned to a different id.
drop policy "own profile" on public.profiles;

create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
