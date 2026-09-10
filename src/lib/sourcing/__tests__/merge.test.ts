// Plain assert-based test runnable with `node --experimental-strip-types`.
// Same style as dedupe.test.ts — only imports from types.ts (Firestore/
// 'server-only'-free) so mergeSourcedLocationsPure is testable without a DB.
import assert from 'node:assert/strict';
import { buildUpsertDoc, mergeSourcedLocationsPure, type AdminUser, type SourcedLocationInput } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const admin: AdminUser = { uid: 'u1', email: 'rinzhinjalal@gmail.com', name: 'Rinshin' };

const spotheroInput: SourcedLocationInput = {
  name: '1320 NW 12th St. - Lot 18',
  address: '1320 NW 12th St, Miami, FL',
  lat: 25.789,
  lng: -80.226,
  source: 'spothero',
  sourceUrl: 'https://spothero.com/listing/94167',
  sourceListingId: '94167',
  priceText: '$10/day',
  capturedBy: 'scraped',
  rawInput: { raw: 'spothero' },
};

const parkopediaInput: SourcedLocationInput = {
  name: 'Municipal Lot 18',
  address: 'Municipal Lot 18',
  lat: 25.78901,
  lng: -80.22601,
  source: 'parkopedia',
  sourceUrl: 'https://en.parkopedia.com/parking/lot/401186',
  sourceListingId: '401186',
  hoursText: 'Mon-Sun 00:00-24:00',
  capturedBy: 'scraped',
  rawInput: { raw: 'parkopedia' },
};

test('merge: fills empty fields on primary from secondary', () => {
  const primary = buildUpsertDoc(null, spotheroInput, '2026-08-23T00:00:00.000Z');
  const secondary = buildUpsertDoc(null, parkopediaInput, '2026-08-23T00:00:00.000Z');

  const { mergedPrimary } = mergeSourcedLocationsPure(primary, secondary, admin, '2026-08-23T01:00:00.000Z');

  assert.equal(mergedPrimary.hours_text, 'Mon-Sun 00:00-24:00'); // filled from secondary
  assert.equal(mergedPrimary.price_text, '$10/day'); // primary's own value kept
  assert.equal(mergedPrimary.field_sources.hours_text, 'verified'); // admin-approved fill
  assert.equal(mergedPrimary.captured_by, 'admin');
});

test('merge: conflicting field logged as a note, primary value wins', () => {
  const primary = buildUpsertDoc(null, spotheroInput, '2026-08-23T00:00:00.000Z');
  const secondary = buildUpsertDoc(
    null,
    { ...parkopediaInput, name: 'Different Name Entirely' },
    '2026-08-23T00:00:00.000Z',
  );

  const { mergedPrimary } = mergeSourcedLocationsPure(primary, secondary, admin, '2026-08-23T01:00:00.000Z');

  assert.equal(mergedPrimary.name, '1320 NW 12th St. - Lot 18', 'primary value must survive');
  assert.ok(
    mergedPrimary.notes?.includes('conflict:name:1320 NW 12th St. - Lot 18|Different Name Entirely'),
    `notes was: ${mergedPrimary.notes}`,
  );
});

test('merge: evidence appended exactly once, not duplicated if source already present', () => {
  const primary = buildUpsertDoc(null, spotheroInput, '2026-08-23T00:00:00.000Z');
  const secondary = buildUpsertDoc(null, parkopediaInput, '2026-08-23T00:00:00.000Z');

  const { mergedPrimary } = mergeSourcedLocationsPure(primary, secondary, admin, '2026-08-23T01:00:00.000Z');
  assert.equal(mergedPrimary.evidence.length, 2);
  assert.ok(mergedPrimary.evidence.some((e) => e.source === 'parkopedia'));

  // Re-merging a secondary whose source is already in primary's evidence
  // (simulated by merging again with the same already-merged-once primary)
  // must not add a second parkopedia evidence entry.
  const secondaryAgain = buildUpsertDoc(null, { ...parkopediaInput, priceText: '$5/day' }, '2026-08-23T00:00:00.000Z');
  const { mergedPrimary: mergedTwice } = mergeSourcedLocationsPure(
    mergedPrimary,
    secondaryAgain,
    admin,
    '2026-08-23T02:00:00.000Z',
  );
  assert.equal(mergedTwice.evidence.length, 2, 'evidence must not duplicate the same source');
});

test('merge: secondary keeps all its own data and additionally gains merged_into_lot_id', () => {
  const primary = buildUpsertDoc(null, spotheroInput, '2026-08-23T00:00:00.000Z');
  const secondary = buildUpsertDoc(null, parkopediaInput, '2026-08-23T00:00:00.000Z');

  const { markedSecondary } = mergeSourcedLocationsPure(primary, secondary, admin, '2026-08-23T01:00:00.000Z');

  assert.equal(markedSecondary.merged_into_lot_id, primary.id);
  assert.equal(markedSecondary.name, secondary.name);
  assert.equal(markedSecondary.hours_text, secondary.hours_text);
  assert.equal(markedSecondary.status, secondary.status, "status: 'draft' unchanged");
  assert.equal(markedSecondary.id, secondary.id);
  assert.deepEqual(markedSecondary.evidence, secondary.evidence, 'secondary itself is untouched otherwise');
});

test('merge: rejects merging an already-merged secondary', () => {
  const primary = buildUpsertDoc(null, spotheroInput, '2026-08-23T00:00:00.000Z');
  const otherPrimary = buildUpsertDoc(
    null,
    { ...spotheroInput, sourceListingId: '99999', sourceUrl: 'https://spothero.com/listing/99999' },
    '2026-08-23T00:00:00.000Z',
  );
  const secondary = buildUpsertDoc(null, parkopediaInput, '2026-08-23T00:00:00.000Z');

  const { markedSecondary } = mergeSourcedLocationsPure(primary, secondary, admin, '2026-08-23T01:00:00.000Z');

  assert.throws(
    () => mergeSourcedLocationsPure(otherPrimary, markedSecondary, admin, '2026-08-23T02:00:00.000Z'),
    /already merged/,
  );
});

test('merge: rejects merging a record into itself', () => {
  const primary = buildUpsertDoc(null, spotheroInput, '2026-08-23T00:00:00.000Z');
  assert.throws(() => mergeSourcedLocationsPure(primary, primary, admin, '2026-08-23T01:00:00.000Z'));
});

console.log('\nall merge tests passed');
