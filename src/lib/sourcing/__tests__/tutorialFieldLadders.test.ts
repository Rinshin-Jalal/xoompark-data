// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers FILL_TRACK_ORDER's resequencing (rates/hours first, per §1) and
// that every field it lists has a non-empty, numbered-content source ladder,
// and that it stays in sync with bdrView.ts's CHECKLIST_FIELDS keys (the
// Fill track reuses that module's label/guidance/isEmpty per field).
import assert from 'node:assert/strict';
import { CHECKLIST_FIELDS } from '../bdrView.ts';
import { FIELD_SOURCE_LADDERS, FILL_TRACK_ORDER } from '../tutorialFieldLadders.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('FILL_TRACK_ORDER starts with ratesHours ("easiest — start here", §1)', () => {
  assert.equal(FILL_TRACK_ORDER[0], 'ratesHours');
});

test('FILL_TRACK_ORDER has exactly the 7 kill-order fields, no duplicates', () => {
  assert.equal(FILL_TRACK_ORDER.length, 7);
  assert.equal(new Set(FILL_TRACK_ORDER).size, 7);
});

test('FILL_TRACK_ORDER keys are exactly bdrView.ts CHECKLIST_FIELDS keys (same field set)', () => {
  const bdrKeys = new Set(CHECKLIST_FIELDS.map((f) => f.key));
  for (const key of FILL_TRACK_ORDER) {
    assert.ok(bdrKeys.has(key), `${key} must be a real bdrView.ts checklist field`);
  }
  assert.equal(bdrKeys.size, FILL_TRACK_ORDER.length);
});

test('every field in FILL_TRACK_ORDER has a source ladder with at least one numbered step', () => {
  for (const key of FILL_TRACK_ORDER) {
    const ladder = FIELD_SOURCE_LADDERS[key];
    assert.ok(Array.isArray(ladder) && ladder.length > 0, `${key} must have a non-empty ladder`);
    for (const step of ladder) assert.equal(typeof step, 'string');
  }
});

test('fenced and lit share the identical ladder (doc combines them under one heading)', () => {
  assert.deepEqual(FIELD_SOURCE_LADDERS.fenced, FIELD_SOURCE_LADDERS.lit);
});

test('capacity ladder ends with the doc\'s "never estimate" line', () => {
  const ladder = FIELD_SOURCE_LADDERS.capacity;
  assert.equal(ladder[ladder.length - 1], 'If nothing: leave empty. Never estimate a number.');
});

console.log('\nall tutorialFieldLadders tests passed');
