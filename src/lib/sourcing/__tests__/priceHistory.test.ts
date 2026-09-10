// Plain assert-based test runnable with `node --experimental-strip-types`.
// Covers priceHistory: differing incoming prices append as observations,
// current priceText never overwritten, identical prices don't duplicate.
import assert from 'node:assert/strict';
import { buildUpsertDoc, type SourcedLocationInput } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const baseInput: SourcedLocationInput = {
  name: 'Downtown Lot A',
  address: '123 Main St',
  source: 'spothero',
  sourceUrl: 'https://spothero.com/facility/12345/x-parking',
  sourceListingId: '12345',
  priceText: '$10.00 (2hr)',
  capturedBy: 'scraped',
  rawInput: { raw: true },
};

test('create: first price seeds the history', () => {
  const doc = buildUpsertDoc(null, baseInput, '2026-09-08T00:00:00.000Z');
  assert.deepEqual(doc.priceHistory, [
    { seenAt: '2026-09-08T00:00:00.000Z', priceText: '$10.00 (2hr)', sourceUrl: baseInput.sourceUrl },
  ]);
});

test('create: no price -> no history', () => {
  const doc = buildUpsertDoc(null, { ...baseInput, priceText: undefined }, '2026-09-08T00:00:00.000Z');
  assert.equal(doc.priceHistory, undefined);
});

test('merge: differing incoming price appends, current price survives', () => {
  const existing = buildUpsertDoc(null, baseInput, '2026-09-08T00:00:00.000Z');
  const merged = buildUpsertDoc(
    existing,
    { ...baseInput, source: 'osm', sourceUrl: 'https://osm.org/lot/1', priceText: '$12.00 (2hr)' },
    '2026-09-09T00:00:00.000Z',
  );
  assert.equal(merged.priceText, '$10.00 (2hr)', 'current price never overwritten');
  assert.equal(merged.priceHistory?.length, 2);
  assert.deepEqual(merged.priceHistory?.[1], {
    seenAt: '2026-09-09T00:00:00.000Z', priceText: '$12.00 (2hr)', sourceUrl: 'https://osm.org/lot/1',
  });
  // the conflict note still fires (existing audit behaviour, untouched)
  assert.ok(merged.notes?.includes('conflict:priceText:$10.00 (2hr)|$12.00 (2hr)'));
});

test('merge: identical price does not duplicate history', () => {
  const existing = buildUpsertDoc(null, baseInput, '2026-09-08T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, { ...baseInput, source: 'osm' }, '2026-09-09T00:00:00.000Z');
  assert.equal(merged.priceHistory?.length, 1);
});

test('merge: price arriving on an empty field fills it AND records it', () => {
  const existing = buildUpsertDoc(null, { ...baseInput, priceText: undefined }, '2026-09-08T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, { ...baseInput, source: 'osm', priceText: '$8.00' }, '2026-09-09T00:00:00.000Z');
  assert.equal(merged.priceText, '$8.00');
  assert.equal(merged.priceHistory?.length, 1);
  assert.equal(merged.priceHistory?.[0].priceText, '$8.00');
});

console.log('\nall priceHistory tests passed');
