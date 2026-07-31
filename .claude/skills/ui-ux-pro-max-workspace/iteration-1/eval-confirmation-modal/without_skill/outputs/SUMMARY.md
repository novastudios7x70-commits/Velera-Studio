# Delete-project confirmation modal

## What was built

Added end-to-end project deletion from the dashboard — there was no delete
functionality at all before this.

- **`ConfirmModal`** (`src/components/ui/ConfirmModal.tsx`) — a generic,
  reusable destructive-action confirmation dialog, not hardwired to "delete a
  project" so other flows (cancel a job, remove a brand asset, etc.) can
  reuse it later. Handles Escape-to-close, backdrop-click-to-close, focuses
  the confirm button on open, locks body scroll while open, and disables
  both buttons while a delete is in flight.
- **`DangerButton`** (`src/components/ui/Button.tsx`) — new sibling to the
  existing `PrimaryButton`/`GhostButton`, styled with the existing `coral`
  accent (the codebase's de-facto error/danger color — it's already used for
  the "Failed" job-status label and form error text; there's no separate red
  hue in the design tokens, so introducing one would fight the two-accent
  system in CLAUDE.md).
- **`ProjectList`** (`src/components/screens/ProjectList.tsx`) — the
  dashboard's project-card list, pulled out of the server component into a
  client component so it can hold local state (which project is pending
  deletion, optimistic removal after a successful delete) and render the
  modal + toast. Each card gets a `Trash2` icon button; clicking it opens
  `ConfirmModal` with the project's file name and clip count in the copy.
- **`DELETE /api/projects/[id]`** (`src/app/api/projects/[id]/route.ts`) —
  the real deletion endpoint. `id` is the `jobs.id` shown on the dashboard.
  It authenticates the caller, reads the job/upload/clips through the
  request-scoped Supabase client (RLS — "own jobs"/"own uploads" — makes
  someone else's project id come back as a clean 404 instead of a 403,
  so the endpoint never confirms whether an id exists), best-effort removes
  the underlying storage objects (raw upload + rendered clip files/
  thumbnails), then deletes the `uploads` row. `jobs.upload_id` and
  `clips.job_id` are both `on delete cascade`, so that single delete clears
  every DB row for the project in one RLS-authorized statement — no
  service-role bypass anywhere in the request path.
- **`src/lib/storage-paths.ts`** — tiny helper to turn a clip's public CDN
  URL back into a storage object path so it can be passed to
  `storage.from("clips").remove([...])`.
- **`supabase/migrations/0005_clips_delete_policy.sql`** — the `clips`
  bucket previously only had `select`/`insert` RLS policies (writes go
  through the worker's service-role key, which bypasses RLS, so a delete
  policy was never added). Added an "owner delete" policy mirroring the
  existing one on the `uploads` bucket, using the same
  `${userId}/${jobId}/${fileName}` path convention the worker already
  writes — otherwise a user's own session could never clean up their
  rendered clip files.

## UI/UX decisions

- **Confirm-then-delete, not undo-after-delete.** Given clip files (ffmpeg
  renders) are expensive to regenerate and there's no "trash"/restore
  concept anywhere else in the schema, a blocking confirmation reads safer
  than a toast-with-undo pattern for this action.
- **No "type the project name to confirm" step.** That pattern is reserved
  in most products for irreversible actions with very high blast radius
  (deleting an org, a production database). A single upload's clips don't
  rise to that bar, and CLAUDE.md's "polished, not flashy" bar argues against
  adding unnecessary friction — a clear two-button modal with the file name
  and clip count in the body copy gives enough of a pause.
- **"Stretched link" card pattern.** The existing card was itself a
  `<Link>`, which meant nesting a `<button>` for delete inside it — invalid
  HTML (nested interactive elements) and unreliable to click without
  `stopPropagation` hacks. Restructured so the `<Link>` is an
  `absolute inset-0` overlay with an `aria-label`, and the delete button
  sits in a higher `z-index` sibling layer. Keeps the whole-row-clickable
  behavior for opening a project while making the delete button a clean,
  independently-clickable escape hatch.
- **Coral for danger, not a new red.** Matches the two-accent design system
  (teal/coral) rather than introducing a third color that isn't in
  `design-tokens.ts`.
- **Toast on both outcomes.** Success shows "Project deleted" via the
  existing `ToastProvider`; failure shows the server's error message (or a
  fallback) the same way `BillingButtons.tsx` already does for its API
  calls — keeps the delete flow consistent with existing error-handling
  conventions instead of inventing a new one.
- **Optimistic-on-confirmation, not optimistic-on-click.** The row is only
  removed from local state after the API call succeeds, so a failed delete
  (e.g. network blip) leaves the project visible and the user gets a toast
  explaining why, rather than the row silently reappearing on next refresh.

## Verified

- `npx tsc --noEmit` — clean.
- `npm run build` (Next.js/Turbopack) — compiles, and `/api/projects/[id]`
  shows up in the route table.
- `npx eslint` on every changed/new file — no errors or warnings.
