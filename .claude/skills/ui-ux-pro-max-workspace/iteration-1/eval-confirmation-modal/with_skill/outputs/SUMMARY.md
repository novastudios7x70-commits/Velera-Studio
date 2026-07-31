# Delete-project confirmation modal

## What was built

- **`ConfirmDialog`** (`src/components/ui/ConfirmDialog.tsx`) — a new,
  reusable confirmation-modal primitive (not a one-off for this feature).
  Backdrop blur + `nova-fade-in`, `role="alertdialog"`/`aria-modal`/
  `aria-labelledby`/`aria-describedby`, Escape-to-close, body-scroll lock,
  and autofocus on the confirm button. Takes a `danger` flag so it can be
  reused for any destructive confirmation, not just this one.
- **`DangerButton`** (`src/components/ui/Button.tsx`) + **`.nova-btn-danger`**
  (`src/app/globals.css`) — a coral-gradient sibling to the existing
  `.nova-btn-primary`, extending the token file the same way the primary
  button does rather than hardcoding a one-off destructive-button style.
- **`ProjectCard`** (`src/components/dashboard/ProjectCard.tsx`) — a new
  client component that owns one dashboard row: the existing clickable
  card content (unchanged visually) plus a trash icon-button and the
  delete flow (open confirm → call the API → toast → `router.refresh()`).
  Extracted out of `dashboard/page.tsx` (a Server Component) because the
  delete interaction needs client state.
- **`DELETE /api/jobs/[id]`** (`src/app/api/jobs/[id]/route.ts`) — deletes
  a project for real via Supabase. `uploads` is the actual root of a
  "project" (`jobs.upload_id` and `clips.job_id` both `on delete cascade`
  per the existing schema), so the handler deletes the `uploads` row and
  lets Postgres cascade the job + all its clips in one statement. RLS
  (`own uploads` / `own jobs`, both `for all using (auth.uid() = user_id)`)
  is the only ownership check — a job that doesn't resolve under RLS reads
  as 404, which is also correct for someone probing another user's id. It
  also best-effort deletes the raw file from the private `uploads` Storage
  bucket (which has an owner-scoped delete policy); rendered clip files
  in the public `clips` bucket are written by the worker under the service
  role and have no client-facing delete policy yet, so that cleanup is
  left as a noted follow-up rather than silently failing the request.
- `src/lib/time.ts` — `timeAgo()` extracted out of `dashboard/page.tsx` so
  `ProjectCard` doesn't duplicate it.

## UI/UX decisions

- **Confirmation is a modal, not `window.confirm()` or inline row
  expansion** — matches the app's existing elevated-surface language
  (`.nova-card` + shadow) instead of an unstyled browser dialog, and gives
  room for a specific, named consequence ("`X` and its N clips will be
  permanently deleted") rather than a generic "are you sure?".
- **Delete lives outside the row's `<Link>`**, as a sibling icon-button, not
  nested inside the anchor — avoids invalid HTML nesting and accidental
  navigation when someone means to delete. The button is `40×40px` to meet
  the app's own hit-target floor, with a visible `focus-visible` ring and
  an `aria-label` that names the specific project (icon-only buttons need
  a real accessible name, not just a title-less trash icon).
- **Danger gets its own color, used only for danger** — coral
  (`--coral`) was already reserved for "Failed" status and warnings, so a
  coral confirm button keeps one consistent meaning for that color instead
  of introducing a third accent. Everything else in the dialog (icon
  chip, cancel button) stays neutral/violet so coral reads as the one
  thing demanding attention.
- **Motion matches the existing restrained vocabulary** — reused
  `.nova-fade-in` for both the backdrop and panel at a slightly shorter
  duration, no bounce/elastic easing, consistent with the rest of the app.
- **Optimistic-but-safe delete flow** — button shows "Deleting…" and
  disables both actions while the request is in flight (no double-submit),
  success closes the modal + toasts + `router.refresh()`s the server
  component so the list re-fetches from Supabase (no manual client-side
  list mutation to keep in sync), failure re-enables the buttons and shows
  an error toast so the user can retry from the same state.

## Verified

- `npx tsc --noEmit` — no type errors.
- `npx eslint` on all changed/added files — no errors.
- `npx next build` (production build, dummy env vars) — compiles and
  generates `/api/jobs/[id]` as a route with no errors.
