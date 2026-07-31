# Upload page — premium polish

## Files changed
- `src/app/upload/page.tsx` — full visual + interaction rework
- `src/components/ui/StepPill.tsx` — extended with an optional `onClick` so a completed step can be re-visited

## What changed and why it reads as more premium

**Orientation & hierarchy**
- Added a `nova-mono` uppercase eyebrow ("Step 1 of 3" etc.) above each heading, and bumped headings to 24px with tight tracking — more editorial confidence, matching the `.nova-display` voice used on the landing page.
- The connecting lines between step pills now fill teal once a step is complete instead of staying a static hairline — the progress indicator actually communicates progress.
- Step pills for completed steps are now clickable, letting a user jump back and revise an earlier choice (clears state from that step forward) instead of only moving forward or leaving the flow entirely. This closes a real functional gap in the original.

**Depth & atmosphere**
- Added the same restrained ambient teal glow (`.nova-pulse-glow` + radial gradient) used on the landing page, anchored above the flow — ties the upload page into the same visual system as the marketing page instead of feeling like a bare form.
- Choice cards (content type, visual source) now carry an icon-in-soft-circle badge (matching the pattern already used in the dashboard empty state and contact page) instead of a bare icon, plus a chevron that fades in on hover to signal "this is a choice," not just a label.

**The dropzone (the core interaction on this page) got the most work**
- Real drag-and-drop, not just click-to-browse, with a visible drag-over state.
- Fixed a real accessibility gap: the old zone was a `div` with an `onClick`, unreachable by keyboard. It's now a `<label>` wrapping a focusable input with a `focus-within` ring, so Tab + Enter/Space works.
- Once a file is chosen: shows formatted size ("24.3 MB") and a "Choose a different file" action, rather than silently requiring another click on the same zone to replace it.
- Accepted formats are shown as small mono chips (`MP4` `MOV` `MP3`...) instead of a run-on sentence — quieter and easier to scan.

**Supporting elements elevated to match**
- The beat-sync toggle and the "Visual style" generate-mode fields are now `.nova-card` rows with icon badges/section labels instead of a plain bordered strip and three floating inputs.
- The error message is now an icon + coral-tinted alert row instead of bare colored text — color is no longer the only signal carrying that information (accessibility principle from the skill).
- Every input, card, and the dropzone got a visible `focus` / `focus-visible` ring — none of them had one before, a real keyboard-accessibility gap across the page.
- Added a small trust line under the submit button ("Private by default — nothing is posted without you.") — a one-line reassurance common in funded-SaaS uploaders, kept restrained (single line, muted, one small shield glyph).

Nothing new was invented outside the existing token/motion vocabulary — no new colors, no new animation curves, no new fonts. The changes lean entirely on `.nova-card`, `.nova-card-select`, `.nova-pulse-glow`, `.nova-fade-in`, and the existing violet/coral/panel/void tokens, applied more deliberately than the original flat version.
