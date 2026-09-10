// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers the tutorial step-gating state machine: unlock rules, completeStep
// advancing/clamping, goToStep's no-op-when-locked guard, and the tolerant
// (de)serialization round-trip.
import assert from 'node:assert/strict';
import {
  completeStep,
  goToStep,
  HUNT_PROGRESS_KEY,
  huntProgressKey,
  INITIAL_PROGRESS,
  isStepUnlocked,
  makeProgressReader,
  parseProgress,
  serializeProgress,
} from '../tutorialProgress.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('INITIAL_PROGRESS starts at step 0 with only step 0 unlocked', () => {
  assert.equal(INITIAL_PROGRESS.step, 0);
  assert.equal(isStepUnlocked(INITIAL_PROGRESS, 0), true);
  assert.equal(isStepUnlocked(INITIAL_PROGRESS, 1), false);
});

test('completeStep unlocks and advances to the next step', () => {
  const p1 = completeStep(INITIAL_PROGRESS, 0, 5);
  assert.equal(p1.step, 1);
  assert.equal(p1.unlockedThrough, 1);
  assert.equal(isStepUnlocked(p1, 1), true);
  assert.equal(isStepUnlocked(p1, 2), false);
});

test('completeStep on the last step clamps instead of walking off the end', () => {
  const p = completeStep({ step: 4, unlockedThrough: 4 }, 4, 5);
  assert.equal(p.step, 4);
  assert.equal(p.unlockedThrough, 4);
});

test('completeStep never un-unlocks a step already unlocked further ahead', () => {
  // Learner is back on step 0 after having already unlocked through step 3;
  // re-completing step 0 must not regress unlockedThrough.
  const advanced = { step: 0, unlockedThrough: 3 };
  const p = completeStep(advanced, 0, 5);
  assert.equal(p.unlockedThrough, 3);
});

test('goToStep jumps to an unlocked step', () => {
  const p = goToStep({ step: 2, unlockedThrough: 3 }, 1);
  assert.equal(p.step, 1);
});

test('goToStep is a no-op when the target step is still locked', () => {
  const start = { step: 0, unlockedThrough: 0 };
  const p = goToStep(start, 2);
  assert.deepEqual(p, start);
});

test('serialize/parse round-trips a real progress object', () => {
  const p = { step: 3, unlockedThrough: 4 };
  assert.deepEqual(parseProgress(serializeProgress(p)), p);
});

test('parseProgress falls back to INITIAL_PROGRESS for null', () => {
  assert.deepEqual(parseProgress(null), INITIAL_PROGRESS);
});

test('parseProgress falls back to INITIAL_PROGRESS for garbage JSON', () => {
  assert.deepEqual(parseProgress('{not json'), INITIAL_PROGRESS);
});

test('parseProgress falls back to INITIAL_PROGRESS for a malformed shape', () => {
  assert.deepEqual(parseProgress(JSON.stringify({ step: 'two' })), INITIAL_PROGRESS);
  assert.deepEqual(parseProgress(JSON.stringify({ step: -1, unlockedThrough: -1 })), INITIAL_PROGRESS);
});

// --- makeProgressReader -----------------------------------------------------
// Regression coverage for a real bug hit during the tutorial rework:
// useSyncExternalStore's getSnapshot must return a referentially STABLE
// value when the underlying data hasn't changed, or React logs "getSnapshot
// should be cached" and can loop. parseProgress alone returns a fresh object
// literal every call, so the reader must memoize by raw string.

test('makeProgressReader: outside a browser (no window), always returns the same INITIAL_PROGRESS reference', () => {
  const read = makeProgressReader('some-key');
  const a = read();
  const b = read();
  assert.equal(a, INITIAL_PROGRESS);
  assert.equal(a, b); // same reference, not just deep-equal
});

test('makeProgressReader: in a browser-like env, repeated reads of an unchanged value return the same reference', () => {
  const store = new Map<string, string>();
  store.set('k', JSON.stringify({ step: 2, unlockedThrough: 3 }));
  const fakeLocalStorage = { getItem: (k: string) => store.get(k) ?? null };
  // @ts-expect-error -- test-only globals to simulate a browser environment
  globalThis.window = {};
  // @ts-expect-error -- test-only globals to simulate a browser environment
  globalThis.localStorage = fakeLocalStorage;
  try {
    const read = makeProgressReader('k');
    const a = read();
    const b = read();
    assert.equal(a, b); // same reference across calls with no change
    assert.deepEqual(a, { step: 2, unlockedThrough: 3 });

    store.set('k', JSON.stringify({ step: 5, unlockedThrough: 5 }));
    const c = read();
    assert.notEqual(c, a); // value actually changed -> new reference
    assert.deepEqual(c, { step: 5, unlockedThrough: 5 });
  } finally {
    // @ts-expect-error -- cleanup test-only globals
    delete globalThis.window;
    // @ts-expect-error -- cleanup test-only globals
    delete globalThis.localStorage;
  }
});

// --- huntProgressKey ---------------------------------------------------
// Regression coverage for a real bug: Hunt's progress used to live under one
// GLOBAL key regardless of locality, so picking a new locality after
// finishing (or partway through) a previous one carried that previous
// locality's unlockedThrough forward — the new locality's step 2-4 would
// show as already unlocked despite never having been worked.

test('huntProgressKey namespaces by locality', () => {
  assert.equal(huntProgressKey('Doral'), `${HUNT_PROGRESS_KEY}::Doral`);
  assert.equal(huntProgressKey('Kendall'), `${HUNT_PROGRESS_KEY}::Kendall`);
  assert.notEqual(huntProgressKey('Doral'), huntProgressKey('Kendall'));
});

test('huntProgressKey collapses "no locality picked yet" to one shared bucket', () => {
  assert.equal(huntProgressKey(null), `${HUNT_PROGRESS_KEY}::none`);
});

test('makeProgressReader: two localities keep fully independent progress', () => {
  const store = new Map<string, string>();
  const fakeLocalStorage = { getItem: (k: string) => store.get(k) ?? null };
  // @ts-expect-error -- test-only globals to simulate a browser environment
  globalThis.window = {};
  // @ts-expect-error -- test-only globals to simulate a browser environment
  globalThis.localStorage = fakeLocalStorage;
  try {
    // Doral gets worked all the way through (unlockedThrough: 4).
    const doralKey = huntProgressKey('Doral');
    store.set(doralKey, serializeProgress({ step: 4, unlockedThrough: 4 }));

    // Kendall is picked next — its own key was never written, so a reader
    // for it must NOT see Doral's unlockedThrough.
    const kendallKey = huntProgressKey('Kendall');
    const readKendall = makeProgressReader(kendallKey);
    assert.deepEqual(readKendall(), INITIAL_PROGRESS);
    assert.equal(isStepUnlocked(readKendall(), 4), false);

    // Doral's own reader is unaffected and still sees its real progress.
    const readDoral = makeProgressReader(doralKey);
    assert.deepEqual(readDoral(), { step: 4, unlockedThrough: 4 });
  } finally {
    // @ts-expect-error -- cleanup test-only globals
    delete globalThis.window;
    // @ts-expect-error -- cleanup test-only globals
    delete globalThis.localStorage;
  }
});

console.log('\nall tutorialProgress tests passed');
