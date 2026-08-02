@AGENTS.md

# Velora Studio

One upload → platform-ready short-form clips for TikTok, YouTube Shorts,
Instagram Reels, Facebook, and Pinterest. Two content types (music, spoken),
two visual paths (has footage / generate for me).

## Stack

- **Frontend + API**: Next.js (App Router, TypeScript, Tailwind v4) in the
  repo root — `src/app`. Server Components + Server Actions for
  auth/reads, API routes (`src/app/api/**`) for anything that needs to write
  through RLS, call Stripe, or enqueue a job.
- **Worker**: `worker/` — a **separate** Node package/deployable
  (BullMQ consumer). Never import across the `src/` ↔ `worker/` boundary;
  they share a hand-maintained copy of `database.types.ts` instead. Deployed
  independently (Railway/Render) from the Next.js app (Vercel).
- **Auth, database, storage**: Supabase. Schema + RLS in
  `supabase/migrations/`. `uploads` bucket is private (owner-only), `clips`
  bucket is public (served straight from Supabase's CDN — never route
  rendered file bytes back through the Next.js server).
- **Queue**: BullMQ + Redis (`src/lib/queue.ts` producer,
  `worker/src/queue.ts` + `worker/src/index.ts` consumer). An upload always
  creates a `queued` job row and hands off to the queue — processing never
  happens inline inside a request handler.
- **Payments**: Stripe (Checkout for upgrades, Billing Portal for self-serve
  cancel — see `src/app/api/stripe/*`).
- **Transcription**: AssemblyAI (`worker/src/pipeline/transcribe.ts`).
- **Text-to-speech**: ElevenLabs, feature-flagged (see below) —
  `worker/src/pipeline/tts.ts`.
- **Audio analysis / beat detection**: librosa via a Python subprocess
  (`worker/scripts/audio_analysis.py`), invoked from
  `worker/src/pipeline/audioAnalysis.ts`.
- **Segment selection**: Anthropic (`worker/src/pipeline/selectSegments.ts`),
  structured JSON output validated with zod, with a deterministic
  heuristic fallback if the model call/parse fails twice.
- **Visual generation**: Higgsfield, feature-flagged (see below).
- **Rendering**: ffmpeg (`worker/src/pipeline/ffmpegRender.ts` +
  `captions.ts` for ASS subtitle burn-in).

## Build order this was built in (and should extend in)

1. Scaffold (Next.js + `worker/` package)
2. Supabase auth + schema + RLS
3. Upload UI (2-question fork) + Storage
4. Spoken + has-footage path end to end (transcript → LLM select → ffmpeg → captions → results)
5. Music + has-footage path (swap in audio analysis, reuse cut/caption/export)
6. Generate-visuals layer (Higgsfield) for both content types
7. Stripe billing + plan/credit gating
8. Remaining pages: pricing, contact, settings, legal, landing polish

When adding new functionality, slot it into this order rather than bolting
it onto whichever piece is fastest to reach.

## Design tokens (do not drift from these)

Source of truth: `src/lib/design-tokens.ts` + `src/app/globals.css`.

- Background: void black `#0a0a0e` / panel `#111116` / hairline border
  `rgba(255,255,255,0.08)`
- Accents: signal teal `#14B8A6` (primary), warm amber `#F5A524` (secondary)
- Text: `#F2F1F6` (primary), `#8A8A96` (muted)
- Fonts: **Outfit** (`.nova-display` — headings, bold/tight, negative
  letter-spacing), **Plus Jakarta Sans** (`.nova-root` — body),
  **JetBrains Mono** (`.nova-mono` — small labels/badges)
- Motion: subtle only — `.nova-fade-in`, `.nova-pulse-glow`,
  `.nova-card-select` hover-lift. Nothing bouncy, nothing that calls
  attention to itself as "an effect."
- Bar: polished/funded-SaaS premium, not flashy-indie. Soft layered shadows
  over heavy borders, restrained glow on primary CTAs, noise texture
  (`.nova-noise`) on dark surfaces instead of flat black.

## Credit model (why the code is shaped this way)

- Trial: 3 clips total, 1 generated-visual clip, no expiry — see
  `profiles.clips_remaining` / `generated_clips_remaining`.
- Paid plans: `clips_monthly_allowance` / `generated_clips_allowance` reset
  each billing cycle via the `invoice.paid` Stripe webhook.
- Enforcement happens in two places by design, not one:
  1. **`create_job()`** (`supabase/migrations/0003_functions.sql`) — reserves
     1 clip credit atomically (row-locked) the moment a job is created. This
     is what stops a burst of requests from queuing more jobs than a plan
     allows — a job literally cannot exist without an available credit.
  2. **`claim_clip_credit()`**, called by the worker once segment selection
     knows the real segment count (3-5) — tops up the reservation one credit
     at a time, and the job simply stops adding clips once credits run out,
     rather than failing.
  3. **`refund_job_reservation()`** — called on any pipeline failure so a
     crashed job never silently burns the user's credit.
- The generated-clip sub-cap is an internal enforcement detail. Never surface
  it as a separate unit in the UI — just "X of Y clips used," per the
  original spec.

## Feature flag: generate-visuals path

Higgsfield's redistribution licensing was unconfirmed when this was built,
so the path was gated behind two flags until that was resolved — **it now
has been confirmed** (commercial redistribution of Higgsfield-generated
output is allowed), so both flags are meant to be `true` in production. The
flags themselves stay in place as the on/off switch for this feature, just
no longer defaulting to off:

- `GENERATE_VISUALS_ENABLED` (server) — `src/app/api/jobs/route.ts` rejects
  `visual_source: "generate"` requests when this is off, and the worker's
  `generateVisual()` refuses to run.
- `NEXT_PUBLIC_GENERATE_VISUALS_ENABLED` (client) — the upload flow disables
  the "Generate for me" option in the UI when this is off, rather than
  leaving it clickable and failing.

Real API contract (confirmed against Higgsfield's own docs, see
`worker/src/pipeline/generateVisuals.ts`): there is no direct text-to-video
model, so this is a two-step pipeline — a still image is generated from the
mood/style/prompt first, then animated. Both steps are billed per job, not
per output clip (all 3-5 clips a job produces share the one generated
visual), so cost scales with how many times a user invokes generate-for-me,
not with clip count.

## Feature flag: text-to-speech (AI voiceover) path

Lets a user type a script instead of uploading a recording — only offered
for `content_type: "spoken"` (a script isn't meaningful for music). Same
dual-flag pattern as generate-visuals, gated because it's a new paid-API-cost
path, not for any licensing reason:

- `TTS_ENABLED` (server) — `src/app/api/jobs/route.ts` rejects
  `audio_source: "tts"` requests when this is off.
- `NEXT_PUBLIC_TTS_ENABLED` (client) — the upload flow only shows the
  "Write a script" toggle when this is on.

Shape of the feature: `uploads.audio_source` (`'upload' | 'tts'`) plus
`script_text`/`tts_voice_id` when it's `'tts'` — `file_url` is nullable to
allow this, enforced by a check constraint
(`uploads_source_consistency` in `0006_tts.sql`) rather than at the
application layer alone. The worker's first pipeline step
(`worker/src/pipeline/tts.ts`) calls ElevenLabs' plain synchronous
text-to-speech endpoint (`POST /v1/text-to-speech/{voice_id}`, one
well-documented call, no polling) to get the voiceover audio, re-hosts it in
the `uploads` bucket the same way generated visuals are re-hosted, and then
feeds it into the **existing, already-proven** spoken-content pipeline
(AssemblyAI transcription, LLM segment selection, ffmpeg render) completely
unchanged — deliberately not using ElevenLabs' timestamped-output variant,
to avoid re-deriving word timings from an unfamiliar, less-common endpoint
shape. `jobs.status` has a matching `generating_voiceover` state so the
processing screen shows a real step for it, ordered before `analyzing`.
Voice options are fetched live from `GET /api/tts/voices`, a thin
server-side proxy over ElevenLabs' `GET /v1/voices` — the API key never
reaches the browser.

## Competitive positioning — check every decision against this

**Cut/avoid**: chasing frontier generation models (Higgsfield only, not
Sora-class APIs); trying to serve "everyone" instead of staying narrow
(musicians + faceless creators); confusing credit systems (the sub-cap
enforcement rule above exists specifically to prevent this); long-form/
documentary editing features.

**Double down**: "no footage, generate for me" as a named first-class
feature, not buried; simple transparent pricing; broad platform export in
one pipeline; good onboarding.

Before adding scope, check it against this section first.

## Legal/compliance surfaces already wired up

- `/privacy`, `/terms` — real pages, not placeholders. Terms includes the
  UGC ownership affirmation + indemnification clause and a DMCA notice
  process (`COMPANY.dmcaEmail` in `src/lib/company.ts`).
- Signup requires an unchecked-by-default ToS/Privacy checkbox
  (`profiles.terms_accepted_at` records consent) and a separate,
  also-unchecked marketing-consent checkbox.
- Cancellation is self-serve via the Stripe Billing Portal
  (`src/app/api/stripe/portal`) — never "contact us to cancel" — and fires a
  cancellation confirmation email on `customer.subscription.deleted`.
- `src/lib/email.ts` centralizes all outbound email so the CAN-SPAM footer
  (physical address, unsubscribe link on marketing mail) can't drift between
  templates. **No email provider is wired up yet** — see the TODO in that
  file; it currently logs instead of sending until `RESEND_API_KEY` is set.

## Known TODOs / integration points to confirm before going live

- `worker/src/pipeline/generateVisuals.ts` — built against Higgsfield's
  documented async submit→poll→download job contract; confirm exact
  endpoint paths/payload shape against their current API reference (no live
  credentials were available to exercise this in the build environment).
- `src/lib/email.ts` — needs a real provider (Resend assumed) wired up via
  `RESEND_API_KEY`.
- Caption rendering uses the system "DejaVu Sans" font
  (`worker/src/pipeline/captions.ts`) as a safe default available in the
  Docker image. For on-brand captions, bundle Outfit/Plus Jakarta Sans TTFs
  into `worker/assets/fonts` and point ffmpeg's `fontsdir` at them.
