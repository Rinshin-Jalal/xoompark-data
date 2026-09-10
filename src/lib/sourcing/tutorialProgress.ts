// Pure step-gating state machine for the Hunt track's guided locality sweep
// (tutorial/HuntTrack.tsx). No localStorage access here: the component owns
// the actual read/write, this module only owns the transition rules +
// (de)serialization, same "pure logic vs thin UI/IO wrapper" split as the
// rest of this pipeline (bdrView.ts, hardFilters.ts, locality.ts).

export interface TrackProgress {
  /** Step the learner is currently looking at. */
  step: number;
  /** Highest step index ever unlocked — a step is accessible iff
   * step <= unlockedThrough. Monotonic: never decreases, so revisiting an
   * earlier step never re-locks a later one. */
  unlockedThrough: number;
}

export const INITIAL_PROGRESS: TrackProgress = { step: 0, unlockedThrough: 0 };

export function isStepUnlocked(progress: TrackProgress, stepIndex: number): boolean {
  return stepIndex <= progress.unlockedThrough;
}

/**
 * Call when the action/checkbox gating `stepIndex` completes. Unlocks the
 * next step and advances the current pointer to it, clamped to the last
 * step so completing the final step doesn't walk off the end.
 */
export function completeStep(progress: TrackProgress, stepIndex: number, totalSteps: number): TrackProgress {
  const last = Math.max(totalSteps - 1, 0);
  const next = Math.min(stepIndex + 1, last);
  return { step: next, unlockedThrough: Math.max(progress.unlockedThrough, next) };
}

/** Jump to a previously-unlocked step (e.g. clicking an earlier segment of
 * the progress bar) — no-op if that step isn't unlocked yet. */
export function goToStep(progress: TrackProgress, stepIndex: number): TrackProgress {
  return isStepUnlocked(progress, stepIndex) ? { ...progress, step: stepIndex } : progress;
}

export function serializeProgress(progress: TrackProgress): string {
  return JSON.stringify(progress);
}

/** Tolerant parse — any malformed/missing localStorage value falls back to
 * INITIAL_PROGRESS rather than throwing (a corrupted key should never brick
 * the tutorial). */
export function parseProgress(raw: string | null): TrackProgress {
  if (!raw) return INITIAL_PROGRESS;
  try {
    const parsed = JSON.parse(raw) as Partial<TrackProgress>;
    if (
      typeof parsed?.step === 'number' && parsed.step >= 0
      && typeof parsed?.unlockedThrough === 'number' && parsed.unlockedThrough >= 0
    ) {
      return { step: parsed.step, unlockedThrough: parsed.unlockedThrough };
    }
  } catch {
    // fall through to default
  }
  return INITIAL_PROGRESS;
}

/**
 * Builds a `useSyncExternalStore` getSnapshot function for `key`, memoized
 * by the raw string so repeated reads of an unchanged localStorage value
 * return the SAME object reference. Without this, parseProgress's fresh
 * `{ step, unlockedThrough }` literal on every call reads as "changed" to
 * React (object identity, not deep-equality) and triggers its
 * "getSnapshot should be cached" infinite-loop warning/loop.
 */
export function makeProgressReader(key: string): () => TrackProgress {
  let lastRaw: string | null = null;
  let lastParsed: TrackProgress = INITIAL_PROGRESS;
  return () => {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(key);
    if (raw !== lastRaw) {
      lastRaw = raw;
      lastParsed = parseProgress(raw);
    }
    return lastParsed;
  };
}

// --- localStorage key names -------------------------------------------------
export const HUNT_PROGRESS_KEY = 'parking-sourcing-tutorial-hunt-progress';
export const HUNT_LOCALITY_KEY = 'parking-sourcing-tutorial-hunt-locality';

/**
 * Hunt's progress key, namespaced per locality. Without this, HUNT_PROGRESS_KEY
 * alone was a single global bucket shared by every locality: picking a new
 * locality after finishing (or partially working) a previous one carried that
 * previous locality's `unlockedThrough` forward, showing later steps as
 * already-unlocked for a locality the learner hadn't touched yet. Locality
 * "none" (nothing picked yet) collapses to one shared bucket — harmless since
 * step 0 (the picker) is the same screen regardless of which locality, if any,
 * was previously active.
 */
export function huntProgressKey(locality: string | null): string {
  return `${HUNT_PROGRESS_KEY}::${locality ?? 'none'}`;
}
