// Plain assert-based test runnable with `node --experimental-strip-types`.
// No vitest at repo root (only functions/ has it) — this follows the
// fallback convention the task specified. Only imports from types.ts, which
// is deliberately Firestore/'server-only'-free so it runs under plain node.
import assert from 'node:assert/strict';
import { buildUpsertDoc, computeDedupeKey, type SourcedLocationInput, type SourcedParkingLocation } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// ── key computation ─────────────────────────────────────────────────────────

test('computeDedupeKey: listingId path', () => {
  const key = computeDedupeKey({ source: 'spothero', sourceListingId: '12345' });
  assert.equal(key, 'spothero:12345');
});

test('computeDedupeKey: addr path, slugified, unit number stripped', () => {
  const key = computeDedupeKey({ source: 'osm', address: '123 Main St., Apt 4B' });
  assert.equal(key, 'addr:123-main-st');
});

test('computeDedupeKey: throws with neither listingId nor address', () => {
  assert.throws(() => computeDedupeKey({ source: 'osm' }));
});

// ── upsert-create ────────────────────────────────────────────────────────────

const baseInput: SourcedLocationInput = {
  name: 'Downtown Lot A',
  address: '123 Main St',
  source: 'spothero',
  sourceUrl: 'https://spothero.com/listing/12345',
  sourceListingId: '12345',
  priceText: '$10/day',
  capturedBy: 'scraped',
  rawInput: { raw: true },
};

test('upsert-create: new doc is draft with single evidence entry', () => {
  const doc = buildUpsertDoc(null, baseInput, '2026-08-23T00:00:00.000Z');
  assert.equal(doc.id, 'spothero:12345');
  assert.equal(doc.status, 'draft');
  assert.equal(doc.evidence.length, 1);
  assert.deepEqual(doc.evidence[0], { source: 'spothero', url: baseInput.sourceUrl, seen_at: '2026-08-23T00:00:00.000Z' });
  assert.equal(doc.raw_input, baseInput.rawInput);
  assert.equal(doc.created_at, '2026-08-23T00:00:00.000Z');
});

// ── upsert-merge-fills-empty ──────────────────────────────────────────────────

test('upsert-merge: fills empty fields, adds new source to evidence', () => {
  const existing = buildUpsertDoc(null, baseInput, '2026-08-23T00:00:00.000Z');
  // existing has no hoursText/capacityText — a second source fills them in.
  const secondInput: SourcedLocationInput = {
    name: 'Downtown Lot A',
    source: 'parkopedia',
    sourceUrl: 'https://parkopedia.com/listing/999',
    sourceListingId: '12345', // same key on purpose to hit the merge path directly
    hoursText: '24/7',
    capacityText: '50 spaces',
    capturedBy: 'scraped',
    rawInput: { raw: 2 },
    fieldProvenance: { hours_text: 'verified' },
  };
  const merged = buildUpsertDoc(existing, secondInput, '2026-08-24T00:00:00.000Z');

  assert.equal(merged.hours_text, '24/7');
  assert.equal(merged.capacity_text, '50 spaces');
  assert.equal(merged.field_sources.hours_text, 'verified');
  assert.equal(merged.field_sources.capacity_text, 'unknown');
  assert.equal(merged.evidence.length, 2);
  assert.ok(merged.evidence.some((e) => e.source === 'parkopedia'));
  assert.equal(merged.updated_at, '2026-08-24T00:00:00.000Z');
  assert.equal(merged.status, 'draft'); // untouched by merge
});

test('upsert-merge: re-seeing the same source does not duplicate evidence', () => {
  const existing = buildUpsertDoc(null, baseInput, '2026-08-23T00:00:00.000Z');
  const reseen: SourcedLocationInput = { ...baseInput, priceText: '$12/day' };
  const merged = buildUpsertDoc(existing, reseen, '2026-08-25T00:00:00.000Z');
  assert.equal(merged.evidence.length, 1);
  // priceText already non-empty on existing -> conflict, not overwritten
  assert.equal(merged.price_text, '$10/day');
});

// ── conflict-preservation ─────────────────────────────────────────────────────

test('conflict-preservation: existing non-empty value wins, conflict logged in notes', () => {
  const existing = buildUpsertDoc(null, baseInput, '2026-08-23T00:00:00.000Z');
  const conflicting: SourcedLocationInput = {
    ...baseInput,
    source: 'parkopedia',
    sourceUrl: 'https://parkopedia.com/listing/999',
    priceText: '$8/day', // conflicts with existing '$10/day'
  };
  const merged = buildUpsertDoc(existing, conflicting, '2026-08-26T00:00:00.000Z');

  assert.equal(merged.price_text, '$10/day', 'existing value must survive');
  assert.ok(merged.notes?.includes('conflict:price_text:$10/day|$8/day'), `notes was: ${merged.notes}`);
});

test('conflict-preservation: multiple conflicts across merges append, never overwrite silently', () => {
  let doc: SourcedParkingLocation = buildUpsertDoc(null, baseInput, '2026-08-23T00:00:00.000Z');
  doc = buildUpsertDoc(doc, { ...baseInput, source: 'osm', priceText: '$8/day' }, '2026-08-24T00:00:00.000Z');
  doc = buildUpsertDoc(doc, { ...baseInput, source: 'google', priceText: '$9/day' }, '2026-08-25T00:00:00.000Z');

  assert.equal(doc.price_text, '$10/day');
  assert.ok(doc.notes?.includes('conflict:price_text:$10/day|$8/day'));
  assert.ok(doc.notes?.includes('conflict:price_text:$10/day|$9/day'));
  assert.equal(doc.evidence.length, 3);
});

// ── #34: hard-filter fields are real soft fields ─────────────────────────────

test('three-state round trip: Yes -> true, No -> false, Can\'t tell -> null, untouched -> undefined', () => {
  const doc = buildUpsertDoc(
    null,
    {
      ...baseInput,
      access247: true,
      fenced: false,
      lit: null,
      ingressEgress: 'one-way in, separate exit',
      stallsTotal: 62,
    },
    '2026-08-23T00:00:00.000Z',
  );
  assert.equal(doc.is_24_7, true);
  assert.equal(doc.is_fenced, false);
  assert.equal(doc.is_lit, null);
  assert.equal(doc.ingress_egress, 'one-way in, separate exit');
  assert.equal(doc.stall_count, 62);

  const untouched = buildUpsertDoc(null, baseInput, '2026-08-23T00:00:00.000Z');
  assert.equal(untouched.is_24_7, undefined);
  assert.equal(untouched.is_fenced, undefined);
  assert.equal(untouched.is_lit, undefined);
});

test('merge: existing fenced=true + incoming scrape without the field -> stays true, no conflict', () => {
  const existing = buildUpsertDoc(null, { ...baseInput, fenced: true }, '2026-08-23T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, baseInput, '2026-08-24T00:00:00.000Z');
  assert.equal(merged.is_fenced, true);
  assert.ok(!merged.notes?.includes('conflict:is_fenced'), `notes was: ${merged.notes}`);
});

test('merge: incoming fenced=false against existing true -> conflict logged, true wins', () => {
  const existing = buildUpsertDoc(null, { ...baseInput, fenced: true }, '2026-08-23T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, { ...baseInput, source: 'osm', fenced: false }, '2026-08-24T00:00:00.000Z');
  assert.equal(merged.is_fenced, true);
  assert.ok(merged.notes?.includes('conflict:is_fenced:true|false'), `notes was: ${merged.notes}`);
});

test('merge: null (checked, couldn\'t tell) counts as empty — a later real value fills it', () => {
  const existing = buildUpsertDoc(null, { ...baseInput, lit: null }, '2026-08-23T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, { ...baseInput, source: 'osm', lit: true }, '2026-08-24T00:00:00.000Z');
  assert.equal(merged.is_lit, true);
  assert.ok(!merged.notes?.includes('conflict:is_lit'), `notes was: ${merged.notes}`);
});

test('cross-source merge folds the new fields too (toMergeInput)', async () => {
  const { mergeSourcedLocationsPure } = await import('../types.ts');
  const primary = buildUpsertDoc(null, { ...baseInput, fenced: true }, '2026-08-23T00:00:00.000Z');
  const secondary = buildUpsertDoc(
    null,
    {
      ...baseInput,
      source: 'parkopedia',
      sourceListingId: 'pp-1',
      fenced: undefined,
      access247: true,
      stallsTotal: 80,
    },
    '2026-08-23T00:00:00.000Z',
  );
  const { mergedPrimary } = mergeSourcedLocationsPure(
    primary,
    secondary,
    { uid: 'u1', email: 'a@b.c', name: 'A' },
    '2026-08-25T00:00:00.000Z',
  );
  assert.equal(mergedPrimary.is_fenced, true);
  assert.equal(mergedPrimary.is_24_7, true);
  assert.equal(mergedPrimary.stall_count, 80);
});

console.log('\nall dedupe tests passed');
