---
name: ui-ux-pro-max
description: Apply premium, high-end UI/UX craft whenever building, editing, or reviewing any screen or component in Velora Studio — spacing/type discipline, restrained motion, elevation via shadow instead of heavy borders, accessibility minimums, and designed empty/loading/error states. Use this any time UI work is happening here, even if the user just says "make it nicer," "clean this up," "add a page for X," or doesn't mention design at all — the product's whole pitch is "polished, funded SaaS," not "flashy indie side project," so this bar applies by default, not only when explicitly requested.
---

# Premium UI/UX for Velora Studio

## Why this exists

The kickoff brief for this app was explicit: "the bar is highly professional and
premium — think a polished, funded SaaS product, not a flashy indie
side-project. Restraint over flash." That line is doing a lot of work — it's
the difference between a screen that reads as "a real company built this" and
one that reads as "someone's weekend project." Every new screen, modal, or
component added to this app is judged against that same line, whether or not
whoever's asking for it says so explicitly. This skill exists so that bar
doesn't erode one "just add a quick button" at a time.

The principles below are general — they'd make any product feel more
premium, not just this one. But they're written against this project's real
tokens so they're immediately actionable rather than abstract.

## Start here, every time

Before writing or judging any UI, actually open the source of truth — don't
work from memory of what the tokens "probably" are:

- `src/lib/design-tokens.ts` — colors, plan data, platform/hook labels
- `src/app/globals.css` — the `@theme` block, and every `.nova-*` utility class
- `src/components/ui/` — the primitives that already exist (`Button.tsx`,
  `Field.tsx`, `StepPill.tsx`, `ClipThumb.tsx`, `Toast.tsx`) — reuse these
  before inventing a new pattern that does the same job slightly differently

If a new screen needs a color, spacing value, or motion pattern that isn't in
these files, that's a signal to either reuse what's there or deliberately
extend the token file — not to hardcode a one-off hex value or animation
inline. One-off values are how design systems quietly rot.

## Core principles

### 1. Elevation comes from shadow, not borders
Heavy borders read as "wireframe." This app's depth comes from
`.nova-card`'s soft layered shadow (`0 1px 2px rgba(0,0,0,0.2), 0 8px 24px
-12px rgba(0,0,0,0.4)`) plus a hairline border (`--line`,
`rgba(255,255,255,0.08)`) that's barely there. When a component needs to
feel "raised," reach for shadow depth before reaching for a thicker or
brighter border.

### 2. Type has three jobs, not one font
- **Outfit** (`.nova-display`) — headings only. Bold, tight, negative
  letter-spacing at large sizes. This is where the "editorial and confident"
  feeling comes from — don't undersize headings to be "safe."
- **Plus Jakarta Sans** (`.nova-root`, the default) — body copy, labels,
  anything a user reads at length.
- **JetBrains Mono** (`.nova-mono`) — small numeric/status labels only
  (badges, timestamps, plan pills). It signals "system data," so using it
  for prose or headings undercuts that signal.

Mixing these outside their lane is the fastest way to make a screen feel
inconsistent even when every individual choice looks fine in isolation.

### 3. One accent color per moment of emphasis
Teal (`--violet`, `#14B8A6`) is the primary interactive/brand color. Amber
(`--coral`, `#F5A524`) is a secondary accent, used sparingly (gradients,
occasional highlights) — not as a second "primary" button color. If a screen
has three different accent colors fighting for attention, none of them read
as important. When in doubt, more elements should be muted/neutral than
colored — color is for the one or two things that actually matter on that
screen.

### 4. Motion says "this is alive," never "look at this effect"
The existing motion vocabulary is deliberately small: `.nova-fade-in`
(content entering), `.nova-pulse-glow` (a slow ambient background glow),
`.nova-card-select` (a subtle lift + border-color change on hover). New
motion should extend this restrained vocabulary, not introduce bounce,
elastic easing, or anything that calls attention to itself as "an
animation." A good test: if someone described the motion out loud and it
sounds like a feature ("it bounces!"), it's probably too much.

### 5. Spacing should look chosen, not guessed
Pull from a small, repeated set of values rather than picking whatever pixel
number looks fine in the moment — this codebase's existing screens mostly
use gaps/padding around the 2/2.5/3/3.5/4/5/6 Tailwind steps. A screen where
every padding is a slightly different arbitrary number is what makes UI feel
"off" without anyone being able to say exactly why. When editing an existing
screen, match its existing rhythm before introducing a new one.

### 6. Empty, loading, and error states are real screens, not afterthoughts
Every list, card grid, or async view needs a designed state for "nothing
here yet," "still working," and "this failed" — not a blank div or a raw
error string. `Dashboard`'s "No uploads yet" block and `ProcessingView`'s
failure state are the reference pattern: an icon in a soft-color circle, a
short human sentence, and (when relevant) a next action. If you're building
a new data view and only design the "happy path with data" state, the work
isn't done.

### 7. Accessibility is a minimum, not a stretch goal
- `--muted` (`#8A8A96`) on `--void`/`--panel` backgrounds is fine for
  secondary/supporting text but is not high-contrast enough to be the only
  color carrying load-bearing information (form errors, critical status) —
  pair it with an icon, weight change, or a higher-contrast color like
  `--text` or `--coral` for anything that matters.
- Every interactive element needs a visible focus state and a large enough
  hit target (buttons/inputs in this app are already sized around 40-44px
  tall — don't shrink below that for anything clickable).
- Every form input has a real label or `aria-label`, not just a placeholder
  (placeholders disappear the moment someone starts typing).

## Before calling UI work done, check

- Does this reuse existing primitives (`Button`, `Field`, `StepPill`, etc.)
  where one already fits, instead of writing a new one-off?
- Do headings use Outfit, body text Plus Jakarta Sans, and only small
  status/numeric labels use JetBrains Mono?
- Is elevation coming from shadow (`.nova-card`), not a heavier border?
- Is there exactly one clear accent color doing the "this matters" work on
  this screen, not several competing?
- Would you describe any animation as "an effect," or does it just feel like
  the interface responding naturally?
- Does every spacing value roughly match the rhythm already used nearby?
- Empty state, loading state, and error state — designed, not blank?
- Can this be operated with keyboard/screen reader — labeled inputs, visible
  focus, real contrast on anything that matters?

If a change fails more than one of these, it's worth a second pass before
treating the UI work as finished — that's usually the difference between
"looks fine" and "looks premium."
