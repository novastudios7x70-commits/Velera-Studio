// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once the project is linked
// to a real Supabase instance; this file keeps local dev/type-checking
// working without that CLI dependency.
//
// IMPORTANT: every row-shape type below is a `type` alias, not an
// `interface`. postgrest-js's generic Row/Insert/Update constraints check
// `extends Record<string, unknown>`, and TypeScript does NOT consider a
// plain `interface` (declaration-mergeable) to satisfy that check the way it
// does a closed `type` alias — using `interface` here silently breaks all
// query result inference back to `never` with no error at the declaration
// site. Keep these as `type`.

export type Plan = "trial" | "creator" | "studio" | "agency";
export type ContentType = "music" | "spoken";
export type VisualSource = "has" | "generate";
export type AudioSource = "upload" | "tts";
export type JobStatus =
  | "queued"
  | "generating_voiceover"
  | "analyzing"
  | "generating_visuals"
  | "selecting"
  | "awaiting_selection"
  | "cutting"
  | "captioning"
  | "done"
  | "failed";
export type Platform = "tiktok" | "shorts" | "reels" | "facebook" | "pinterest";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  brand_color: string;
  plan: Plan;
  clips_remaining: number;
  generated_clips_remaining: number;
  clips_monthly_allowance: number | null;
  clips_used_this_cycle: number;
  generated_clips_allowance: number | null;
  generated_clips_used_this_cycle: number;
  billing_cycle_start: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  marketing_email_consent: boolean;
  terms_accepted_at: string | null;
  created_at: string;
  streak_count: number;
  streak_last_active_date: string | null;
};

export type VisualStyle = {
  prompt?: string;
  mood?: string;
  genre?: string;
  color?: string;
};

export type Upload = {
  id: string;
  user_id: string;
  file_url: string | null;
  file_name: string;
  content_type: ContentType;
  visual_source: VisualSource;
  mood_description: string | null;
  beat_sync_enabled: boolean;
  visual_style: VisualStyle | null;
  audio_source: AudioSource;
  script_text: string | null;
  tts_voice_id: string | null;
  created_at: string;
};

export type TranscriptWord = {
  text: string;
  start: number; // ms
  end: number; // ms
};

export type Transcript = {
  full_text: string;
  words: TranscriptWord[];
};

export type AudioAnalysisWindow = {
  start: number; // seconds
  end: number; // seconds
  energy: number; // 0-1
  label: "chorus" | "verse" | "bridge" | "intro" | "outro" | "high_energy" | "other";
};

export type BeatGrid = {
  bpm: number;
  beat_timestamps: number[]; // seconds
};

export type AudioAnalysis = {
  windows: AudioAnalysisWindow[];
  beat_grid?: BeatGrid;
};

export type SelectedSegment = {
  start_time: number; // seconds
  end_time: number; // seconds
  hook_type: string;
  suggested_caption: string;
  confidence: number; // 0-100
  thumbnail_url?: string | null; // real frame grabbed from the source at discover time, not LLM output
  why?: string; // Claude-generated "why this was surfaced," grounded in this segment's own transcript excerpt + hook_type
};

export type Job = {
  id: string;
  upload_id: string;
  user_id: string;
  status: JobStatus;
  transcript: Transcript | null;
  audio_analysis: AudioAnalysis | null;
  generated_visual_url: string | null;
  selected_segments: SelectedSegment[] | null;
  confirmed_segment_indices: number[] | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type Clip = {
  id: string;
  job_id: string;
  user_id: string;
  title: string | null;
  hook_type: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_seconds: number | null;
  confidence: number | null;
  platform: Platform;
  file_url: string | null;
  thumbnail_url: string | null;
  downloaded_at: string | null;
  marked_posted_at: string | null;
  approved_at: string | null; // review state — mutually exclusive with rejected_at
  rejected_at: string | null; // soft-hide only; never deletes the row or the storage object
  render_started_at: string | null; // set while a re-render is in flight; cleared on success or failure
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; email: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      uploads: {
        Row: Upload;
        Insert: Partial<Upload> & Pick<Upload, "user_id" | "file_url" | "file_name" | "content_type" | "visual_source">;
        Update: Partial<Upload>;
        Relationships: [];
      };
      jobs: {
        Row: Job;
        Insert: Partial<Job> & Pick<Job, "upload_id" | "user_id">;
        Update: Partial<Job>;
        Relationships: [
          { foreignKeyName: "jobs_upload_id_fkey"; columns: ["upload_id"]; referencedRelation: "uploads"; referencedColumns: ["id"] },
        ];
      };
      clips: {
        Row: Clip;
        Insert: Partial<Clip> & Pick<Clip, "job_id" | "user_id" | "platform">;
        Update: Partial<Clip>;
        Relationships: [
          { foreignKeyName: "clips_job_id_fkey"; columns: ["job_id"]; referencedRelation: "jobs"; referencedColumns: ["id"] },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_job: { Args: { p_upload_id: string }; Returns: Job };
      claim_clip_credit: { Args: { p_user_id: string; p_generated: boolean }; Returns: boolean };
      refund_job_reservation: { Args: { p_job_id: string }; Returns: undefined };
      apply_reclip: {
        Args: {
          p_vertical_clip_ids: string[];
          p_pinterest_clip_ids: string[];
          p_vertical_file_url: string;
          p_pinterest_file_url: string;
          p_thumbnail_url: string;
          p_start_time: string;
          p_end_time: string;
          p_duration_seconds: number;
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
