-- Velora Studio — initial schema
-- profiles, uploads, jobs, clips + RLS. See CLAUDE.md for the trial/plan model
-- this schema implements (usage-based credits, cost-tiered generated-clip sub-cap).

create extension if not exists "pgcrypto";

-- profiles: one row per user, extends Supabase auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  brand_color text default '#14B8A6',
  plan text not null default 'trial'
    check (plan in ('trial', 'creator', 'studio', 'agency')),
  clips_remaining int not null default 3,       -- trial: fixed pool, no expiry
  generated_clips_remaining int not null default 1,  -- trial: sub-cap on the
                                                       -- expensive "generate visuals" path
  clips_monthly_allowance int,                  -- set once on a paid plan
  clips_used_this_cycle int not null default 0,
  generated_clips_allowance int,                -- paid plans: sub-cap on generated clips
  generated_clips_used_this_cycle int not null default 0,
  billing_cycle_start date,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,
  marketing_email_consent boolean not null default false,
  terms_accepted_at timestamptz,                -- consent evidence for ToS/Privacy checkbox at signup
  created_at timestamptz not null default now()
);

-- uploads: the raw file a user submits
create table uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  content_type text not null check (content_type in ('music', 'spoken')),
  visual_source text not null check (visual_source in ('has', 'generate')),
  mood_description text,                        -- optional, for generate path
  beat_sync_enabled boolean not null default false,  -- music uploads only
  visual_style jsonb,                            -- optional style prefs (mood/genre/color) for generate path
  created_at timestamptz not null default now()
);

-- jobs: one processing run for an upload
create table jobs (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references uploads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'queued'
    check (status in (
      'queued', 'analyzing', 'generating_visuals',
      'selecting', 'cutting', 'captioning', 'done', 'failed'
    )),
  transcript jsonb,             -- timestamped transcript, spoken path
  audio_analysis jsonb,         -- energy/mood windows (+ beat grid if beat-sync), music path
  generated_visual_url text,    -- output of Step 2.5, if applicable
  selected_segments jsonb,      -- LLM/segment-selection output (Step 3)
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- clips: final output, one row per generated clip
create table clips (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  title text,
  hook_type text,
  start_time text,
  end_time text,
  duration_seconds int,
  confidence int,
  platform text not null check (
    platform in ('tiktok', 'shorts', 'reels', 'facebook', 'pinterest')
  ),
  file_url text,
  thumbnail_url text,
  downloaded_at timestamptz,      -- set when the user downloads this clip
  marked_posted_at timestamptz,   -- set if the user marks it as posted somewhere
                                   -- (both nullable, unused in v1 logic — just data
                                   -- collection for a future performance-feedback loop)
  created_at timestamptz not null default now()
);

-- Indexes on every foreign key (worker/job-queue read/write patterns hit these constantly)
create index uploads_user_id_idx on uploads (user_id);
create index jobs_upload_id_idx on jobs (upload_id);
create index jobs_user_id_idx on jobs (user_id);
create index jobs_status_idx on jobs (status);
create index clips_job_id_idx on clips (job_id);
create index clips_user_id_idx on clips (user_id);

-- Row Level Security: every table must restrict rows to their owner
alter table profiles enable row level security;
alter table uploads enable row level security;
alter table jobs enable row level security;
alter table clips enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id);
create policy "own uploads" on uploads
  for all using (auth.uid() = user_id);
create policy "own jobs" on jobs
  for all using (auth.uid() = user_id);
create policy "own clips" on clips
  for all using (auth.uid() = user_id);

-- Auto-create a profile row when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, marketing_email_consent, terms_accepted_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'display_name',
    coalesce((new.raw_user_meta_data->>'marketing_email_consent')::boolean, false),
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean is true then now() else null end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keep jobs.updated_at current on every status transition.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_set_updated_at
  before update on jobs
  for each row execute procedure public.set_updated_at();
