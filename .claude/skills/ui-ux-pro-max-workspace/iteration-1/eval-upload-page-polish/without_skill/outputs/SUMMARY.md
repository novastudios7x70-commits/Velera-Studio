# Upload page polish — summary

## Files changed
- `src/app/upload/page.tsx` — rebuilt the 3-step flow with premium details
- `src/app/globals.css` — added supporting utility classes
- `src/components/ui/Switch.tsx` — new reusable brand-styled toggle (replaces the native checkbox)

## What changed and why it reads as more premium

1. **Ambient ombre glow** — added the same soft radial teal glow used on the
   landing hero (`nova-pulse-glow` + `--violet-soft`) behind the page title.
   Ties the upload flow back to the brand's hero moment instead of feeling
   like a bare form, and it's already an established, low-cost pattern in
   this codebase (`src/app/page.tsx`).

2. **Progress line actually shows progress** — the static `bg-line` dashes
   between step pills are now `.nova-step-track` bars that fill with the
   brand gradient as you move forward, instead of always looking identical
   regardless of where you are in the flow.

3. **Answer breadcrumbs with inline edit** — once you've made a choice, a
   row of pill chips ("Music", "I have footage") appears with a pencil icon.
   Clicking one jumps back and resets the right state. Previously the only
   way back was the top-level "back to dashboard" link, which meant losing
   the whole flow to fix a wrong click — a small but real usability tax that
   also just looked unfinished.

4. **Icon badges instead of bare icons** — content-type/visual-source
   choices and the dropzone icon now sit inside a soft tinted rounded
   square (`.nova-icon-badge`) rather than a floating icon. Adds a layer of
   depth/hierarchy consistent with how a funded product would treat an icon
   as a "chip," not an afterthought.

5. **Real dropzone** — added drag-and-drop (`onDragOver`/`onDrop`) with an
   active state (`.nova-dropzone-active`, scale + glow), format badges
   (MP4/MOV/MP3/WAV/M4A as pills) instead of plain text, file-type icon
   swap (audio vs video), human file size, and a "Remove" affordance so
   users aren't stuck re-clicking to swap a file. Client-side extension
   validation was also added (previously only size was checked).

6. **Custom switch, not a checkbox** — the "sync to the beat" control now
   uses a bespoke `Switch` component with the brand gradient and motion,
   replacing the browser-default checkbox, which was the single most
   "un-premium" element on the page.

7. **Styled inputs + micro-copy** — mood/genre/color inputs get a focus
   ring in brand teal; the CTA gained a small trust line ("Clips are
   usually ready in a few minutes") under the button, and headings got
   tighter tracking/leading to match the display-font treatment used
   elsewhere (`page.tsx` hero).

All changes reuse existing tokens (`--violet`, `--violet-soft`, `--coral`,
`--line`, `--panel`) and existing utility classes (`nova-card`,
`nova-card-select`, `nova-fade-in`, `nova-pulse-glow`) rather than
introducing a new palette — nothing here drifts from
`src/lib/design-tokens.ts` / `src/app/globals.css`.

## Verification
- `npx tsc --noEmit` — clean
- `npx eslint src/app/upload/page.tsx src/components/ui/Switch.tsx` — clean
