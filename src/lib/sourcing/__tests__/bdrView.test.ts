// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers the BDR-view pure logic: queue ordering, checklist derivation, and
// translation-map completeness. Same Firestore/'server-only'-free split as
// the rest of __tests__ — only imports bdrView.ts (which only imports
// hardFilters.ts and types.ts).
import assert from 'node:assert/strict';
import {
  bdrChecklistRows,
  buildBdrQueue,
  CHECKLIST_FIELDS,
  contextStripLabel,
  deriveBdrChecklist,
  filterByOdd,
  hasConflictNote,
  isBdrVisible,
  missingChecklistCount,
  PROVENANCE_LABEL,
  PROVENANCE_VALUES,
  STATUS_LABEL,
  STATUS_VALUES,
  floodBanner,
} from '../bdrView.ts';
import type { SourcedParkingLocation } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

let seq = 0;
function makeLocation(overrides: Partial<SourcedParkingLocation> = {}): SourcedParkingLocation {
  seq++;
  return {
    id: `loc-${seq}`,
    name: `Lot ${seq}`,
    source: 'spothero',
    sourceUrl: 'https://example.com',
    evidence: [],
    fieldProvenance: {},
    capturedBy: 'scraped',
    status: 'draft',
    rawInput: null,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

// --- checklist generation ---------------------------------------------------

test('deriveBdrChecklist: lists only the fields still empty', () => {
  const loc = makeLocation({ priceText: '$10/day', hoursText: '9-5', clearanceText: undefined, capacityText: undefined });
  const rows = deriveBdrChecklist(loc);
  const keys = rows.map((r) => r.key);
  // ratesHours is filled (both priceText and hoursText present) so it's absent.
  assert.ok(!keys.includes('ratesHours'));
  // capacity/clearance/open247/fenced/lit/ingressEgress are all still empty.
  assert.deepEqual(keys.sort(), ['capacity', 'clearance', 'fenced', 'ingressEgress', 'lit', 'open247'].sort());
});

test('deriveBdrChecklist: ratesHours only collapses when BOTH price and hours are present', () => {
  const priceOnly = makeLocation({ priceText: '$10/day' });
  assert.ok(deriveBdrChecklist(priceOnly).some((r) => r.key === 'ratesHours'));
  const hoursOnly = makeLocation({ hoursText: '9-5' });
  assert.ok(deriveBdrChecklist(hoursOnly).some((r) => r.key === 'ratesHours'));
});

test('deriveBdrChecklist: collapses to nothing once every field is filled', () => {
  const loc = makeLocation({
    priceText: '$10/day',
    hoursText: '24/7',
    capacityText: '200 spaces',
    clearanceText: "6'8\"",
    access247: true,
    fenced: true,
    lit: true,
    ingressEgress: 'one-way in, separate exit',
  });
  assert.deepEqual(deriveBdrChecklist(loc), []);
});

test('bdrChecklistRows: always returns all 7 rows, tagged done/not-done', () => {
  const loc = makeLocation();
  const rows = bdrChecklistRows(loc);
  assert.equal(rows.length, CHECKLIST_FIELDS.length);
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.done === false));
});

test('missingChecklistCount: counts only empty fields', () => {
  const loc = makeLocation({ priceText: '$10/day', hoursText: '24/7' });
  // ratesHours filled -> 6 remaining of the 7.
  assert.equal(missingChecklistCount(loc), 6);
});

// --- queue ordering ----------------------------------------------------------

test('buildBdrQueue: a record missing more critical fields sorts before one missing fewer', () => {
  const missingLots = makeLocation({ id: 'missing-lots', createdAt: '2026-08-01T00:00:00.000Z' });
  const missingFew = makeLocation({
    id: 'missing-few',
    createdAt: '2026-08-01T00:00:00.000Z',
    priceText: '$10/day',
    hoursText: '24/7',
    capacityText: '200',
    clearanceText: "6'8\"",
  });
  const sorted = buildBdrQueue([missingFew, missingLots]);
  assert.deepEqual(sorted.map((l) => l.id), ['missing-lots', 'missing-few']);
});

test('buildBdrQueue: a flood-failed record sorts last regardless of how much else it is missing', () => {
  const floodFailedButComplete = makeLocation({
    id: 'flood-complete',
    priceText: '$10/day',
    hoursText: '24/7',
    capacityText: '200',
    clearanceText: "6'8\"",
    access247: true,
    fenced: true,
    lit: true,
    ingressEgress: 'one-way in, separate exit',
    geoContext: { floodHazardArea: true, floodZone: 'AE', checkedAt: 'x' },
  });
  const missingEverything = makeLocation({ id: 'missing-everything' });
  const sorted = buildBdrQueue([floodFailedButComplete, missingEverything]);
  assert.deepEqual(sorted.map((l) => l.id), ['missing-everything', 'flood-complete']);
});

test('buildBdrQueue: excludes saved and merged-away records', () => {
  const saved = makeLocation({ id: 'saved', status: 'saved' });
  const merged = makeLocation({ id: 'merged', mergedInto: 'other-id' });
  const draft = makeLocation({ id: 'draft' });
  const sorted = buildBdrQueue([saved, merged, draft]);
  assert.deepEqual(sorted.map((l) => l.id), ['draft']);
});

test('buildBdrQueue: with a seed, ties are broken reproducibly and differently from the default order', () => {
  const a = makeLocation({ id: 'tie-a' });
  const b = makeLocation({ id: 'tie-b' });
  // Same missing-count (both fully empty) and same flood status -> a pure
  // tie, so unseeded falls back to createdAt (both equal here -> stable
  // relative order), seeded reorders by hash instead.
  const seeded1 = buildBdrQueue([a, b], 42).map((l) => l.id);
  const seeded2 = buildBdrQueue([a, b], 42).map((l) => l.id);
  assert.deepEqual(seeded1, seeded2, 'same seed must reproduce the same order');
  // Different seeds aren't guaranteed to differ for every pair, but across
  // enough distinct seeds at least one must reorder these two ties, else the
  // seed isn't doing anything.
  const orders = new Set(Array.from({ length: 20 }, (_, i) => buildBdrQueue([a, b], i).map((l) => l.id).join(',')));
  assert.ok(orders.size > 1, 'varying the seed should vary tie order at least once');
});

// Real coordinates, same as odd.test.ts: Phoenix is inside the real Waymo
// ODD, (0, 0) is far from every zone (a confirmed false, not unknown).
const IN_ODD_COORDS = { lat: 33.45, lng: -112.074 };
const OUT_ODD_COORDS = { lat: 0, lng: 0 };

test('filterByOdd: default (false) keeps only lots inside the Waymo ODD', () => {
  const inOdd = makeLocation(IN_ODD_COORDS);
  const outOdd = makeLocation(OUT_ODD_COORDS);
  const noCoords = makeLocation();
  assert.deepEqual(filterByOdd([inOdd, outOdd, noCoords], false).map((l) => l.id), [inOdd.id]);
});

test('filterByOdd: includeOutsideOdd=true keeps everything, including unknown', () => {
  const inOdd = makeLocation(IN_ODD_COORDS);
  const outOdd = makeLocation(OUT_ODD_COORDS);
  const noCoords = makeLocation();
  assert.deepEqual(
    filterByOdd([inOdd, outOdd, noCoords], true).map((l) => l.id),
    [inOdd.id, outOdd.id, noCoords.id],
  );
});

test('contextStripLabel: appends "added by" only when addedBy is set', () => {
  assert.ok(!contextStripLabel(makeLocation()).includes('added by'));
  assert.ok(contextStripLabel(makeLocation({ addedBy: 'Priya' })).includes('added by Priya'));
});

test('isBdrVisible: false for saved or merged-away, true for plain draft', () => {
  assert.equal(isBdrVisible(makeLocation({ status: 'saved' })), false);
  assert.equal(isBdrVisible(makeLocation({ mergedInto: 'x' })), false);
  assert.equal(isBdrVisible(makeLocation()), true);
});

// --- translation-map completeness --------------------------------------------

test('PROVENANCE_LABEL: every FieldProvenanceValue has a non-empty translation, no stray keys', () => {
  for (const v of PROVENANCE_VALUES) {
    assert.ok(PROVENANCE_LABEL[v] && PROVENANCE_LABEL[v].length > 0, `missing translation for provenance value "${v}"`);
  }
  // Label map covers the full union; PROVENANCE_VALUES is the hand-pickable
  // subset — 'derived' is pipeline-set only (services/resources), never
  // selectable in the BDR queue.
  assert.deepEqual(Object.keys(PROVENANCE_LABEL).sort(), ['derived', ...PROVENANCE_VALUES].sort());
});

test('STATUS_LABEL: every SourcingStatus has a non-empty translation, no stray keys', () => {
  for (const v of STATUS_VALUES) {
    assert.ok(STATUS_LABEL[v] && STATUS_LABEL[v].length > 0, `missing translation for status value "${v}"`);
  }
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...STATUS_VALUES].sort());
});

test('hasConflictNote: true only when notes contains the conflict: marker', () => {
  assert.equal(hasConflictNote(makeLocation({ notes: 'conflict:priceText:$5|$10' })), true);
  assert.equal(hasConflictNote(makeLocation({ notes: 'clean note, no issues' })), false);
  assert.equal(hasConflictNote(makeLocation()), false);
});

test('floodBanner: null when not flood-failed, includes zone letter when known', () => {
  assert.equal(floodBanner(makeLocation()), null);
  const withZone = makeLocation({ geoContext: { floodHazardArea: true, floodZone: 'AE', checkedAt: 'x' } });
  assert.match(floodBanner(withZone) ?? '', /zone AE/);
  const noZone = makeLocation({ geoContext: { floodHazardArea: true, floodZone: null, checkedAt: 'x' } });
  assert.ok(floodBanner(noZone)?.includes("Waymo can't use it"));
});

// --- #34: checklist/queue read the real schema fields ------------------------

test('checklist: stallsTotal alone satisfies the capacity row; tri-state fields satisfy their rows', () => {
  const loc = makeLocation({ stallsTotal: 62, access247: true, fenced: null, lit: false, ingressEgress: 'one-way in' });
  const rows = bdrChecklistRows(loc);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.done]));
  assert.equal(byKey.capacity, true, 'stallsTotal is a stated number');
  assert.equal(byKey.open247, true);
  assert.equal(byKey.fenced, true, 'null = checked/could not tell = done');
  assert.equal(byKey.lit, true, 'false = affirmatively recorded = done');
  assert.equal(byKey.ingressEgress, true);
});

test('queue ordering: a record with the new fields filled sorts after one missing them', () => {
  const thin = makeLocation({ id: 'thin', createdAt: '2026-08-23T00:00:00.000Z' });
  const rich = makeLocation({
    id: 'rich',
    createdAt: '2026-08-22T00:00:00.000Z', // older — would sort first on createdAt alone
    stallsTotal: 55,
    access247: true,
    fenced: true,
    lit: true,
    ingressEgress: 'separate exit',
    priceText: '$10',
    hoursText: '24/7',
    clearanceText: "6'8\"",
  });
  const queue = buildBdrQueue([rich, thin]);
  assert.equal(queue[0].id, 'thin');
  assert.equal(queue[1].id, 'rich');
});

console.log('\nall bdrView tests passed');
