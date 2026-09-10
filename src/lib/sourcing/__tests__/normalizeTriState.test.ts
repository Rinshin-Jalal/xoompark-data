// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Only imports types.ts — pure, no Firestore, no server-only.
import assert from 'node:assert/strict';
import { normalizeTriState } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('real tri-state values pass through untouched', () => {
  assert.equal(normalizeTriState(true), true);
  assert.equal(normalizeTriState(false), false);
  assert.equal(normalizeTriState(null), null);
  assert.equal(normalizeTriState(undefined), undefined);
});

test('legacy strings coerce: yes -> true, no -> false', () => {
  assert.equal(normalizeTriState('yes'), true);
  assert.equal(normalizeTriState('no'), false);
});

test("legacy 'unknown' and any other junk map to undefined (no info)", () => {
  assert.equal(normalizeTriState('unknown'), undefined);
  assert.equal(normalizeTriState('YES'), undefined); // case-sensitive: only exact legacy strings coerce
  assert.equal(normalizeTriState('Yes'), undefined);
  assert.equal(normalizeTriState('maybe'), undefined);
  assert.equal(normalizeTriState(1), undefined);
  assert.equal(normalizeTriState({}), undefined);
});

console.log('normalizeTriState: all tests passed');
