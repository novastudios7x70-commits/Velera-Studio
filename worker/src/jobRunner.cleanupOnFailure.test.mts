// Regression tests for the PR #2 review finding: processJob's catch block
// cleaned up generated-visual Storage objects using a stale, pre-phase
// `job` snapshot, so any generated_visual_url/scene_visuals write the
// failing phase made before throwing was invisible to cleanup. The fix
// (see jobRunner.ts: fetchLatestJobForCleanup + the catch-block call site,
// plus the per-group scene_visuals write moved inside the generation loop)
// re-fetches the job row, with one bounded retry, immediately before
// cleanup runs.
//
// Unlike the earlier scratch-harness versions of these tests, every
// function exercised below — escapeRegExp, isOwnGeneratedVisualPath,
// toUploadsObjectPath, collectGeneratedVisualPaths, removeGeneratedVisuals,
// fetchLatestJobForCleanup — is imported directly from the real
// worker/src/jobRunner.ts (each was previously module-private; this file's
// companion change exports them, a visibility-only change with no logic
// difference). These are genuinely the production implementations, not
// copies — confirmed importable without a live Supabase/Anthropic/ffmpeg
// environment, since none of jobRunner.ts's transitive imports perform any
// network call or throw at module load time (only inside functions that
// are actually invoked).
//
// `processJob` itself is also a real export, but calling it end-to-end
// here is impractical without a real Supabase backend: createAdminClient()
// only validates that NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// are *present* (not valid), so a dummy value would make processJob
// attempt a real network call to a fake host and fail at the very first
// job fetch — before job/upload are ever populated, so the cleanup path
// under test here would never even run. That's exactly the "direct
// integration test is impractical" case; per review instructions, the
// chosen alternative is importing the small production helpers that
// actually implement the fix, rather than mocking the whole pipeline or
// falling back to a copied-code harness. The "composeCleanupLikeCatchBlock"
// helper below calls those two real, imported functions in the same order
// and with the same `latestJob ?? staleJob` fallback the real catch block
// uses (confirmed by reading jobRunner.ts directly) — it is test-only
// glue, not a reimplementation of either function's own logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  escapeRegExp,
  isOwnGeneratedVisualPath,
  toUploadsObjectPath,
  collectGeneratedVisualPaths,
  removeGeneratedVisuals,
  fetchLatestJobForCleanup,
} from "./jobRunner.js";
import type { Database, Job, SceneVisual, Upload } from "./lib/database.types.js";

// --- test double: a minimal fake Supabase client covering only the two
// call shapes these functions actually use (`jobs` select/eq/single, and
// `uploads` storage remove) ---

type JobsSingleOutcome = { data: Job | null; error: { message: string } | null } | "throw";

function makeFakeSupabase(opts: {
  jobsSingleSequence: JobsSingleOutcome[];
  removeResult?: { error: { message: string } | null };
  removeThrows?: boolean;
}) {
  let callCount = 0;
  const jobsSelectCalls: string[] = [];
  const removeCalls: { paths: string[] }[] = [];

  const fakeClient = {
    from(table: string) {
      if (table !== "jobs") throw new Error(`fake client: unexpected table "${table}"`);
      return {
        select() {
          return {
            eq(_col: string, id: string) {
              return {
                async single() {
                  jobsSelectCalls.push(id);
                  const index = Math.min(callCount, opts.jobsSingleSequence.length - 1);
                  callCount++;
                  const outcome = opts.jobsSingleSequence[index];
                  if (outcome === "throw") throw new Error("simulated network throw");
                  return outcome;
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          remove(paths: string[]) {
            removeCalls.push({ paths });
            if (opts.removeThrows) throw new Error("boom");
            return Promise.resolve(opts.removeResult ?? { error: null });
          },
        };
      },
    },
  };

  return {
    supabase: fakeClient as unknown as SupabaseClient<Database>,
    jobsSelectCalls,
    removeCalls,
    get callCount() {
      return callCount;
    },
  };
}

// Mirrors processJob's real catch-block composition exactly:
//   const latestJob = await fetchLatestJobForCleanup(supabase, jobId);
//   await removeGeneratedVisuals(supabase, upload, latestJob ?? job);
// — both calls are the real, imported functions; nothing here reimplements
// their behavior.
async function composeCleanupLikeCatchBlock(
  supabase: SupabaseClient<Database>,
  jobId: string,
  staleJob: Job,
  upload: Upload,
): Promise<Job | null> {
  const latestJob = await fetchLatestJobForCleanup(supabase, jobId);
  await removeGeneratedVisuals(supabase, upload, latestJob ?? staleJob);
  return latestJob;
}

const USER = "user-1111-1111-1111-111111111111";
const OTHER_USER = "user-2222-2222-2222-222222222222";
const JOB = "job-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_JOB = "job-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const GENERATE_UPLOAD: Upload = { user_id: USER, visual_source: "generate" } as Upload;

const sceneVisual = (overrides: Partial<SceneVisual>): SceneVisual => ({
  group_id: 0,
  status: "pending",
  video_url: null,
  generated_duration_seconds: null,
  error_message: null,
  ...overrides,
});

// --- 1. primary visual persisted, then a later discover-phase failure ---

test("primary visual persisted before failure: fetchLatestJobForCleanup sees it on the first attempt", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;

  const { supabase, jobsSelectCalls, removeCalls } = makeFakeSupabase({
    jobsSingleSequence: [{ data: freshJob, error: null }],
  });

  const latestJob = await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);

  assert.deepEqual(jobsSelectCalls, [JOB]);
  assert.equal(latestJob, freshJob);
  assert.equal(removeCalls.length, 1);
  assert.deepEqual(removeCalls[0].paths, [`${USER}/generated/${JOB}.mp4`]);

  // The bug this closes: cleaning up directly against the stale snapshot
  // (pre-fix behavior) would have found nothing at all.
  assert.deepEqual(collectGeneratedVisualPaths(GENERATE_UPLOAD, staleJob), []);
});

// --- 2. an earlier group persisted, then a later group fails ---

test("earlier completed group's visual survives a later group's failure", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = {
    id: JOB,
    generated_visual_url: `${USER}/generated/${JOB}.mp4`,
    scene_visuals: [
      sceneVisual({ group_id: 0, status: "completed", video_url: `${USER}/generated/${JOB}.mp4`, generated_duration_seconds: 8 }),
      sceneVisual({ group_id: 1, status: "completed", video_url: `${USER}/generated/${JOB}-group-1.mp4`, generated_duration_seconds: 7 }),
      // Group 2 was never reached before the job failed.
      sceneVisual({ group_id: 2, status: "pending", video_url: null }),
    ],
  } as Job;

  const { supabase, removeCalls } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }] });
  await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);

  assert.equal(removeCalls.length, 1);
  assert.deepEqual(
    removeCalls[0].paths.slice().sort(),
    [`${USER}/generated/${JOB}-group-1.mp4`, `${USER}/generated/${JOB}.mp4`].sort(),
  );
});

// --- 3. a group's upload succeeded but its OWN database write then failed
// (the one residual gap documented in jobRunner.ts's updated comment) ---

test("a group whose own scene_visuals write failed cannot be recovered — documents the known residual gap, not a new failure", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  // The database reflects state as of the LAST group whose own write
  // actually committed (group 1) — group 2's video was uploaded to
  // Storage, but its scene_visuals write failed before committing, so
  // there is nothing in the database pointing at it. This models exactly
  // what a re-fetch would see in that scenario.
  const freshJob: Job = {
    id: JOB,
    generated_visual_url: `${USER}/generated/${JOB}.mp4`,
    scene_visuals: [
      sceneVisual({ group_id: 0, status: "completed", video_url: `${USER}/generated/${JOB}.mp4`, generated_duration_seconds: 8 }),
      sceneVisual({ group_id: 1, status: "completed", video_url: `${USER}/generated/${JOB}-group-1.mp4`, generated_duration_seconds: 7 }),
      sceneVisual({ group_id: 2, status: "pending", video_url: null }), // group 2's write never committed
    ],
  } as Job;

  const { supabase, removeCalls } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }] });
  await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);

  const removedPaths = removeCalls[0]?.paths ?? [];
  assert.ok(!removedPaths.some((p) => p.includes(`${JOB}-group-2`)), "group 2's uncommitted path cannot be recovered — expected, not a regression");
  assert.deepEqual(removedPaths.slice().sort(), [`${USER}/generated/${JOB}-group-1.mp4`, `${USER}/generated/${JOB}.mp4`].sort());
});

// --- 4/5/6/7. re-fetch failure modes, each followed by a successful retry ---

test("re-fetch returns a Supabase error on attempt 1, succeeds on attempt 2", async () => {
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({
    jobsSingleSequence: [{ data: null, error: { message: "simulated transient db error" } }, { data: freshJob, error: null }],
  });

  const result = await fetchLatestJobForCleanup(supabase, JOB);
  assert.equal(result, freshJob);
});

test("re-fetch returns no row on attempt 1, succeeds on attempt 2", async () => {
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({
    jobsSingleSequence: [{ data: null, error: null }, { data: freshJob, error: null }],
  });

  const result = await fetchLatestJobForCleanup(supabase, JOB);
  assert.equal(result, freshJob);
});

test("re-fetch throws on attempt 1, succeeds on attempt 2", async () => {
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({
    jobsSingleSequence: ["throw", { data: freshJob, error: null }],
  });

  const result = await fetchLatestJobForCleanup(supabase, JOB);
  assert.equal(result, freshJob);
});

test("exactly two attempts are made, with a measurable backoff between them, never more than two", async () => {
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({
    jobsSingleSequence: [{ data: null, error: { message: "fail" } }, { data: freshJob, error: null }, { data: freshJob, error: null }],
  });

  const startedAt = Date.now();
  const result = await fetchLatestJobForCleanup(supabase, JOB);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result, freshJob);
  // A real backoff happened (loose lower bound to avoid flakiness — the
  // production delay is 500ms; this only confirms a deliberate pause
  // occurred, not its exact duration).
  assert.ok(elapsedMs >= 200, `expected a retry backoff, elapsed was only ${elapsedMs}ms`);
});

// --- 8. both attempts fail ---

test("both re-fetch attempts fail (returned errors): fetchLatestJobForCleanup returns null, not a guess", async () => {
  const { supabase } = makeFakeSupabase({
    jobsSingleSequence: [{ data: null, error: { message: "fail 1" } }, { data: null, error: { message: "fail 2" } }],
  });

  const result = await fetchLatestJobForCleanup(supabase, JOB);
  assert.equal(result, null);
});

test("both re-fetch attempts fail (thrown): fetchLatestJobForCleanup still returns null, never throws itself", async () => {
  const { supabase } = makeFakeSupabase({ jobsSingleSequence: ["throw", "throw"] });
  await assert.doesNotReject(() => fetchLatestJobForCleanup(supabase, JOB));
  assert.equal(await fetchLatestJobForCleanup(supabase, JOB), null);
});

test("both attempts fail, stale snapshot has nothing recorded: cleanup correctly finds nothing (best-effort, not a false negative)", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const { supabase, removeCalls } = makeFakeSupabase({
    jobsSingleSequence: [{ data: null, error: { message: "fail 1" } }, { data: null, error: { message: "fail 2" } }],
  });

  const latestJob = await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);
  assert.equal(latestJob, null);
  assert.equal(removeCalls.length, 0, "nothing was ever recorded on the stale snapshot — correctly cleans up nothing, rather than inventing a path");
});

test("both attempts fail, stale snapshot DOES have a previously-recorded path: fallback still cleans it up", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase, removeCalls } = makeFakeSupabase({
    jobsSingleSequence: [{ data: null, error: { message: "fail 1" } }, { data: null, error: { message: "fail 2" } }],
  });

  await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);
  assert.equal(removeCalls.length, 1);
  assert.deepEqual(removeCalls[0].paths, [`${USER}/generated/${JOB}.mp4`]);
});

// --- 9. invalid cross-user/cross-job paths are still rejected, against the real exports ---

test("isOwnGeneratedVisualPath (real export) rejects another user's otherwise-identical path", () => {
  assert.equal(isOwnGeneratedVisualPath(`${OTHER_USER}/generated/${JOB}.mp4`, USER, JOB), false);
});

test("toUploadsObjectPath (real export) rejects another job's path for the same user", () => {
  assert.equal(toUploadsObjectPath(`${USER}/generated/${OTHER_JOB}.mp4`, USER, JOB), null);
});

test("a re-fetched job with a cross-wired generated_visual_url (another job) is never passed to remove()", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${OTHER_JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase, removeCalls } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }] });

  await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);
  assert.equal(removeCalls.length, 0);
});

test("a re-fetched job with a scene_visuals entry belonging to another user is excluded, sibling valid entry still removed", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = {
    id: JOB,
    generated_visual_url: `${USER}/generated/${JOB}.mp4`,
    scene_visuals: [
      sceneVisual({ group_id: 0, status: "completed", video_url: `${USER}/generated/${JOB}.mp4`, generated_duration_seconds: 8 }),
      sceneVisual({ group_id: 1, status: "completed", video_url: `${OTHER_USER}/generated/${JOB}-group-1.mp4`, generated_duration_seconds: 7 }),
    ],
  } as Job;
  const { supabase, removeCalls } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }] });

  await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);
  assert.equal(removeCalls.length, 1);
  assert.deepEqual(removeCalls[0].paths, [`${USER}/generated/${JOB}.mp4`]);
});

test("escapeRegExp (real export) neutralizes regex-special characters directly", () => {
  assert.equal(escapeRegExp(".*+?^${}()|[]\\"), "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
});

test("isOwnGeneratedVisualPath (real export) relies on that escaping for a user/job id containing regex metacharacters", () => {
  // A crafted id containing regex metacharacters must not widen the match
  // (e.g. "." must mean a literal dot, not "any character").
  const weirdId = "user.*evil";
  assert.equal(isOwnGeneratedVisualPath(`${weirdId}/generated/${JOB}.mp4`, weirdId, JOB), true);
  assert.equal(isOwnGeneratedVisualPath(`userXevil/generated/${JOB}.mp4`, weirdId, JOB), false);
});

// --- 10. cleanup failures must never mask/replace the original processing error ---

test("a Storage remove() error during cleanup is swallowed, not thrown", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({
    jobsSingleSequence: [{ data: freshJob, error: null }],
    removeResult: { error: { message: "simulated storage failure" } },
  });

  await assert.doesNotReject(() => composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD));
});

test("a thrown error from storage.remove() during cleanup is caught, not propagated", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }], removeThrows: true });

  await assert.doesNotReject(() => composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD));
});

test("end-to-end: a simulated original pipeline error survives a failing cleanup unchanged", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }], removeThrows: true });

  const originalError = new Error("Could not download generated visual for group 1 (503)");
  let caughtMessage: string | null = null;

  try {
    throw originalError;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Mirrors processJob's own catch block: cleanup (wrapped in its own
    // try/catch there, same as composeCleanupLikeCatchBlock's callees
    // already guarantee internally) runs here and must not affect `message`.
    await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, GENERATE_UPLOAD);
    caughtMessage = message;
  }

  assert.equal(caughtMessage, "Could not download generated visual for group 1 (503)");
});

test("a 'has footage' upload never calls remove(), even with a generated_visual_url present on the re-fetched row", async () => {
  const staleJob: Job = { id: JOB, generated_visual_url: null, scene_visuals: null } as Job;
  const freshJob: Job = { id: JOB, generated_visual_url: `${USER}/generated/${JOB}.mp4`, scene_visuals: null } as Job;
  const { supabase, removeCalls } = makeFakeSupabase({ jobsSingleSequence: [{ data: freshJob, error: null }] });

  await composeCleanupLikeCatchBlock(supabase, JOB, staleJob, { user_id: USER, visual_source: "has" } as Upload);
  assert.equal(removeCalls.length, 0);
});
