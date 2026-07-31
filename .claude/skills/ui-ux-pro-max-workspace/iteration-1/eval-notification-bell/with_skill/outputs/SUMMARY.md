# Notification bell — summary

## What was built

- `src/components/ui/NotificationBell.tsx` (new) — a client component: a
  bell icon button with an unread-count badge, opening a dropdown that lists
  the user's most recently completed/failed jobs.
- `src/components/SiteHeader.tsx` (modified) — now fetches the current
  user's 20 most recent `done`/`failed` jobs (joined to `uploads` for
  `file_name`) server-side and passes them into `NotificationBell`. Only
  rendered when a user is logged in, next to the existing "Log out" control.

Data is real, not mocked: it queries the actual `jobs` table (`status`,
`updated_at`) joined to `uploads.file_name`, the same pattern already used
by `dashboard/page.tsx` and `jobs/[id]/page.tsx`, and relies on the same RLS
policy (no explicit `user_id` filter needed).

## UI/UX decisions

- **Reused existing primitives/tokens, didn't invent new ones.** The
  dropdown is `.nova-card` + `.nova-scrollbar` (same shadow-based elevation
  as every other panel in the app), `.nova-fade-in` for the one motion
  moment, and status icons/colors that already exist elsewhere in the
  codebase (`CheckCircle2`/teal for success matches `ResultsView`'s
  `bg-violet-soft` badges; `AlertTriangle`/coral for failure matches
  `ProcessingView`'s failed state exactly, down to the `bg-coral/10` circle).
  No new colors, fonts, or motion vocabulary were introduced.
- **One accent color for "this matters."** Teal carries the unread badge and
  success icon; coral is reserved for the failure case only — matching the
  skill's "one accent per moment of emphasis" rule rather than adding a
  third color for notifications.
- **Bell button matches the existing header button footprint** — same
  `w-10 h-10`, `border-line`, `rounded-lg` as the log-out button, so it
  doesn't introduce a new hit-target size or visual weight next to it.
- **Designed empty state**, not a blank dropdown: a muted bell glyph +
  "Nothing yet — completed jobs will show up here," following the
  icon-in-circle-and-short-sentence pattern used by `Dashboard`'s "No
  uploads yet" and `ProcessingView`'s failure screen.
- **No separate loading state was needed** — notifications are fetched
  server-side before the header ever renders, so there's no client-side
  spinner/skeleton to design for the dropdown's data.
- **Unread tracking is intentionally client-only (localStorage)**, not a new
  DB column/migration. This is a reasonable v1 given the task scope, with a
  documented trade-off (shared across accounts on one browser) and a
  natural upgrade path noted in code (`profiles.notifications_seen_at`)
  if that ever matters.
- **Accessibility**: `aria-haspopup`/`aria-expanded` on the trigger,
  `aria-label` announces the unread count, `role="menu"`/`role="menuitem"`
  on the dropdown/items, closes on outside click and Escape, and
  has a visible `focus-visible` ring using the brand teal — consistent with
  the skill's accessibility-minimums section.
- **Clicking a notification routes exactly like the dashboard does**:
  `done` → `/jobs/[id]/results`, `failed` → `/jobs/[id]` (which renders the
  existing failed-state screen) — no new routing concept invented.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint src/components/SiteHeader.tsx src/components/ui/NotificationBell.tsx` — clean.
- `npm run build` (Next.js production build) — compiles and type-checks
  successfully.
