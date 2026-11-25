# Step 3A scoring rubric

This rubric is for scoring the output of spoken-video segment selection —
individual candidate clips, and sets of candidates from a single run — not
for checking whether the code behaves correctly. Mechanical correctness
(valid duration, non-overlapping segments, sentence-aligned boundaries) is
already covered by `worker/src/pipeline/selectSegments.test.mts`. This
rubric exists because passing all of that tells you nothing about whether a
clip is actually good.

Seven criteria are scored. Six are scored per individual segment
(`SegmentEvaluation.scores`); one — Variety — is scored once per run, across
that run's whole set of segments (`RunEvaluation.varietyScore`), because it
describes a relationship between segments, not a property of any one of
them.

Score each criterion as an integer from 1 to 5. The anchors below define 1,
3, and 5; use your judgment for 2 and 4 as "closer to one anchor than the
other."

## 1. Hook

Does the opening give someone a reason to keep watching in the first ~2-3
seconds?

- **1** — Opens on filler, an introduction, or a transition ("so anyway,"
  "okay so," "let me tell you about"), or on a sentence that requires prior
  context to mean anything. No reason to keep watching yet.
- **3** — Opens on-topic and intelligible, but flat — states a fact or
  continues a thought without any pull (no question, claim, tension, or
  stakes raised). A viewer wouldn't necessarily scroll away, but nothing
  stops them either.
- **5** — The first sentence alone creates genuine pull — a surprising
  claim, a pointed question, a visible stake, or an emotional jolt —
  independent of anything that came before it.

## 2. Self-containedness

Can someone understand the clip with zero outside context?

- **1** — Depends on an unresolved pronoun or reference ("that," "it,"
  "she," "this") pointing outside the clip, or assumes knowledge of a setup
  never stated inside the clip. A cold viewer would be confused.
- **3** — Understandable, but requires the viewer to do some inference — a
  name or situation is named but under-explained, though a careful viewer
  could still follow the gist.
- **5** — Fully self-sufficient — every reference needed to understand the
  moment is established within the clip itself.

## 3. Payoff

Does the moment deliver something meaningful, not just build toward
something?

- **1** — Sets up a question, tension, or story and ends before resolving
  it, or the "payoff" is vague/generic — leaves the viewer hanging without
  intending to.
- **3** — Delivers some resolution, information, or point, but it's
  muted — a mild conclusion, an answer without much weight, a punchline
  that technically lands but doesn't hit hard.
- **5** — Delivers a genuine, specific payoff — a concrete result, a real
  reveal, a landed punchline, or an earned emotional turn — that the setup
  inside the clip actually earns.

## 4. Natural ending

Does it end at a real stopping point, rather than cutting off a thought?

This is where "a complete sentence" and "a complete thought" diverge —
score accordingly, not just on whether the grammar is finished.

- **1** — Cuts off mid-sentence, mid-word, or mid-thought — the clip ends
  and the idea is visibly unfinished.
- **3** — Ends at a grammatically complete sentence, but the thought
  keeps going conceptually right after (e.g. ends right before "...and
  that's when everything changed" would have landed). Technically a clean
  cut, not actually a resting point.
- **5** — Ends exactly where the thought, story, or point resolves —
  nothing is left hanging, and nothing extra lingers past the resolution
  either.

## 5. Variety (scored once per run, across the whole set of segments)

Are the selected moments meaningfully different from each other?

This is where "different clips" and "genuinely diverse moments" diverge —
non-overlapping timestamps are not the same thing as different content.

- **1** — Two or more segments make essentially the same point, tell the
  same beat of the same story, or share the same emotional note, even
  though their timestamps don't overlap.
- **3** — Segments are topically distinct but structurally identical (e.g.
  all three are "surprising fact" style) — different content, same flavor
  throughout.
- **5** — Segments cover genuinely different angles — different topics,
  different emotional registers, different structural roles (one hook-y
  claim, one story beat, one concrete result) — a viewer gets a different
  kind of moment from each.

Record this on `RunEvaluation.varietyScore`, not on any individual
`SegmentEvaluation`. If the run fell through to the heuristic fallback (see
"Fallback runs" below), leave this `null` — there's no model judgment to
score variety across.

## 6. Text-boundary accuracy

Do the boundaries capture the complete thought without unnecessary content,
judged against the **transcript's own** word/sentence timestamps?

This is deliberately narrower than "timestamp accuracy" in general — see
"Text-boundary accuracy vs. audio-boundary accuracy" below for why.

- **1** — The selected span, measured against the transcript's own
  timestamps, clearly misses real content — it starts or ends mid-sentence
  relative to the transcript, excludes a clause the thought needs, or
  spans across a recorded gap (a fixture's own `pauseBeforeSeconds`) into
  dead time.
- **3** — Usable but imprecise — a small amount of the transcript's own
  recorded gap-time is included unnecessarily at an edge, or one extra,
  non-essential sentence is included.
- **5** — The span's boundaries land exactly on the transcript's own
  sentence boundaries bounding the actual thought — nothing truncated,
  nothing extraneous, all verifiable directly from the transcript's text
  and timestamps.

## 7. Creator usefulness

Would a creator genuinely want to publish this clip as-is?

This is the holistic criterion — it can come out lower or higher than the
average of the other six if something specific makes or breaks the clip in
a way the other criteria don't fully capture.

- **1** — No — would need significant re-cutting, or wouldn't be worth
  posting at all (boring, confusing, or broken).
- **3** — Maybe, with minor trimming or a different caption — serviceable
  but not exciting.
- **5** — Yes, as-is — this is specifically the kind of moment a creator
  would be glad the tool surfaced for them.

## Text-boundary accuracy vs. audio-boundary accuracy

**Text-boundary accuracy** (criterion 6, above) is scored from the
transcript's text and timestamps alone — exactly what the synthetic
fixtures in `fixtures/` provide. This is legitimately testable with
synthetic data.

**Audio-boundary accuracy** is a different question: does the *actual
rendered audio/video clip*, when listened to, start and end at points that
sound right — no cut-off breath or word, no jarring amplitude cut, no
bleed from adjacent speech? A clip can score 5/5 on text-boundary accuracy
(timestamps exactly on the transcript's sentence edges) and still sound
wrong, because transcript timestamps are themselves an approximation —
they don't capture breath, trailing consonants, or room noise.

**This is not scored in Step 3A.** It requires a real rendered clip from
real audio (recorded speech or TTS), run through the actual transcription
and ffmpeg rendering pipeline, then actually listened to by a human — none
of which exists for these fixtures, and creating it means either recording
something new or calling a paid TTS/transcription API, both out of scope
here. `SegmentScores.audioBoundaryAccuracy` is reserved as an optional
field in the schema for exactly this reason: so a later step can add real
scores without migrating the data collected now. **Do not populate it from
a synthetic fixture, and do not treat a high text-boundary-accuracy score
as evidence about real audio.**

## Fallback runs

If a run fell through to `heuristicFallback()` (two failed/unparseable
model attempts), its segments did not come from the prompt being compared
at all — the fallback's output doesn't depend on `promptVariant`. Mark
`RunEvaluation.usedFallback = true` for these, leave `varietyScore = null`,
and exclude them from any prompt-quality comparison. `results/validate.mts`
provides `filterComparableRuns()` / `filterComparableSegments()` /
`filterComparable()` to do this filtering mechanically rather than by
hand — they also exclude a run/segment whose `(transcriptId,
promptVariant, runNumber)` key is missing or duplicated, not just a
genuine fallback, so a duplicated key never leaks a "comparable" run into
an aggregate just because one copy happens to say `usedFallback: false`.

## What this rubric is not

- Not a check that the code worked — that's what the unit tests are for. A
  segment can be mechanically perfect (valid duration, sentence-aligned,
  non-overlapping with its siblings) and still score 1 on Hook, Payoff, or
  Creator usefulness.
- Not satisfied by "technically valid" — passing duration/overlap/
  alignment checks only rules out a 1 on Text-boundary accuracy. It says
  nothing about whether the clip is actually compelling.
- Not satisfied by "a complete sentence" — see criterion 4. Ending at a
  sentence boundary is necessary but not sufficient for a 5 on Natural
  ending.
- Not satisfied by "different timestamps" — see criterion 5. Two
  non-overlapping segments making the same point still score low on
  Variety.
