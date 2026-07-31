# Notification bell — implementation summary

## What was built

A working notifications system surfaced from the header, backed by the real
`jobs` table (no mock data, no new schema):

- **`src/components/SiteHeader.tsx`** (server component, modified) — when a
  user is signed in, queries their `jobs` rows where `status in ('done',
  'failed')`, joined to `uploads(file_name)`, ordered by `updated_at desc`,
  capped at 8. RLS already scopes `jobs` to the owning user (same pattern as
  the existing dashboard query), so no extra `user_id` filter was needed.
  Also computes how many of those completions landed in the last 24h and
  passes that count down as `newCount`.
- **`src/components/NotificationBell.tsx`** (new, client component) — the
  bell button + dropdown. Shows a badge with `newCount` (capped at "9+"),
  opens a panel listing each completion with a status icon, filename,
  outcome text ("finished processing" / "failed to process"), and relative
  time. Done items link to `/jobs/[id]/results`, failed items link to
  `/jobs/[id]` (mirrors the dashboard's own link logic). Closes on outside
  click, Escape, or selecting an item. Has a real empty state, not just a
  blank panel.
- **`src/lib/format.ts`** (new) — extracted the `timeAgo` helper that used
  to live inline in `dashboard/page.tsx` so the bell and the dashboard share
  one implementation instead of drifting. Also added `isWithinLast`.
- **`src/app/dashboard/page.tsx`** (modified) — now imports `timeAgo` from
  the shared helper instead of defining its own copy; no behavior change.

## UI/UX decisions

- **No new "read" state / notifications table.** The schema has no
  per-user read tracking, and adding one felt like scope creep for a header
  affordance. Instead the badge counts completions from the last 24h as a
  recency-based proxy for "new" — cheap, accurate enough for the use case,
  and avoids a migration.
- **Reused the dashboard's existing visual language** rather than inventing
  new patterns: `nova-card` for the panel surface, the same violet-soft /
  coral-10 icon chip treatment the dashboard uses for content-type icons,
  the same coral-for-failure / violet-for-success color split the dashboard
  already uses for job status, and `nova-fade-in` for the open transition
  (per CLAUDE.md's "subtle motion only" rule).
- **Split server/client cleanly.** Data fetching stays in the server
  component (`SiteHeader`); the client component only owns interaction
  state (open/closed). This also sidestepped a `react-hooks/purity` lint
  rule that flags calling `Date.now()` directly inside a component's
  render — the "is this notification new" check now lives in a plain
  helper function (`isWithinLast`) computed server-side, so the badge count
  is deterministic and never drifts from server time.
- **Two distinct destinations per item** (results page for done, job status
  page for failed) rather than a single generic link, so clicking a
  notification actually takes you somewhere useful for that job's state —
  consistent with how the dashboard project list already behaves.
- **Real empty state** ("You'll see job updates here once a clip finishes
  processing.") instead of hiding the bell or showing nothing, so the
  affordance doesn't look broken for brand-new accounts.
- **Badge only renders when count > 0** to keep the header calm when
  there's nothing new, matching the product's "polished, not flashy" bar.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint` on all changed/added files — clean (including the
  `react-hooks/purity` rule this repo enforces).
- `npm run build` (Next.js 16, Turbopack) — compiles and generates all
  routes successfully.
