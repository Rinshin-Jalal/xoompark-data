// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same Firestore-free style as hardFilters.test.ts — only imports
// reviewFilters.ts, which only imports hardFilters.ts + types.ts.
import assert from 'node:assert/strict';
import { applyReviewFilters, EMPTY_REVIEW_FILTERS, hasActiveReviewFilters, type ReviewFilters } from '../reviewFilters.ts';
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
    source_name: 'spothero',
    source_url: 'https://example.com',
    evidence: [],
    field_sources: {},
    captured_by: 'scraped',
    status: 'draft',
    raw_input: null,
    created_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    // Real Waymo-Phoenix coordinates by default (isInWaymoOdd computes
    // true here — see odd.test.ts) so the pre-existing dimension tests
    // below (none of which care about ODD) aren't silently filtered out by
    // the odd:'in' default in EMPTY_REVIEW_FILTERS — the odd-specific tests
    // further down override lat/lng explicitly on every fixture they build.
    lat: 33.45,
    lng: -112.074,
    ...overrides,
  };
}

function filters(overrides: Partial<ReviewFilters> = {}): ReviewFilters {
  return { ...EMPTY_REVIEW_FILTERS, ...overrides };
}

// --- search -------------------------------------------------------------

test('applyReviewFilters search: matches name', () => {
  const a = makeLocation({ name: 'Brickell Garage' });
  const b = makeLocation({ name: 'Downtown Lot' });
  const result = applyReviewFilters([a, b], filters({ search: 'brickell' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

test('applyReviewFilters search: matches address', () => {
  const a = makeLocation({ name: 'Lot A', address: '123 SE 2nd St' });
  const b = makeLocation({ name: 'Lot B', address: '456 NW 5th Ave' });
  const result = applyReviewFilters([a, b], filters({ search: 'nw 5th' }));
  assert.deepEqual(result.map((l) => l.id), [b.id]);
});

test('applyReviewFilters search: case-insensitive', () => {
  const a = makeLocation({ name: 'BRICKELL GARAGE' });
  const result = applyReviewFilters([a], filters({ search: 'brickell' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

// --- locality -------------------------------------------------------------

test('applyReviewFilters locality: exact match only', () => {
  const a = makeLocation({ locality: 'Brickell' });
  const b = makeLocation({ locality: 'South Beach' });
  const result = applyReviewFilters([a, b], filters({ locality: 'Brickell' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

// --- added_by --------------------------------------------------------------

test('applyReviewFilters added_by: exact match only', () => {
  const a = makeLocation({ added_by: 'Priya' });
  const b = makeLocation({ added_by: 'Sam' });
  const c = makeLocation();
  const result = applyReviewFilters([a, b, c], filters({ added_by: 'Priya' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

// --- status -------------------------------------------------------------

test('applyReviewFilters status: draft/saved', () => {
  const a = makeLocation({ status: 'draft' });
  const b = makeLocation({ status: 'saved' });
  assert.deepEqual(applyReviewFilters([a, b], filters({ status: 'saved' })).map((l) => l.id), [b.id]);
  assert.deepEqual(applyReviewFilters([a, b], filters({ status: 'draft' })).map((l) => l.id), [a.id]);
});

// --- source -------------------------------------------------------------

test('applyReviewFilters source_name: matches an explicit known source', () => {
  const a = makeLocation({ source_name: 'laz' });
  const b = makeLocation({ source_name: 'spothero' });
  const result = applyReviewFilters([a, b], filters({ source_name: 'laz' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

test('applyReviewFilters source_name: other catches non-listed sources', () => {
  const a = makeLocation({ source_name: 'extension' });
  const b = makeLocation({ source_name: 'spothero' });
  const result = applyReviewFilters([a, b], filters({ source_name: 'other' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

// --- flood / residential (via evaluateHardFilter) --------------------------

test('applyReviewFilters flood: pass/fail/unknown', () => {
  const pass = makeLocation({ geoContext: { floodHazardArea: false, checkedAt: 'x' } });
  const fail = makeLocation({ geoContext: { floodHazardArea: true, checkedAt: 'x' } });
  const unknown = makeLocation();
  assert.deepEqual(applyReviewFilters([pass, fail, unknown], filters({ flood: 'pass' })).map((l) => l.id), [pass.id]);
  assert.deepEqual(applyReviewFilters([pass, fail, unknown], filters({ flood: 'fail' })).map((l) => l.id), [fail.id]);
  assert.deepEqual(
    applyReviewFilters([pass, fail, unknown], filters({ flood: 'unknown' })).map((l) => l.id),
    [unknown.id],
  );
});

test('applyReviewFilters residential: pass/fail/unknown', () => {
  const pass = makeLocation({ geoContext: { residentialAdjacent: false, checkedAt: 'x' } });
  const fail = makeLocation({ geoContext: { residentialAdjacent: true, checkedAt: 'x' } });
  const unknown = makeLocation();
  assert.deepEqual(
    applyReviewFilters([pass, fail, unknown], filters({ residential: 'pass' })).map((l) => l.id),
    [pass.id],
  );
  assert.deepEqual(
    applyReviewFilters([pass, fail, unknown], filters({ residential: 'fail' })).map((l) => l.id),
    [fail.id],
  );
  assert.deepEqual(
    applyReviewFilters([pass, fail, unknown], filters({ residential: 'unknown' })).map((l) => l.id),
    [unknown.id],
  );
});

// --- odd --------------------------------------------------------------------

// Real coordinates, same as odd.test.ts: Phoenix is inside the real Waymo
// ODD, (0, 0) is far from every zone (a confirmed false, not unknown).
const IN_ODD_COORDS = { lat: 33.45, lng: -112.074 };
const OUT_ODD_COORDS = { lat: 0, lng: 0 };

test('applyReviewFilters odd: default (EMPTY_REVIEW_FILTERS) shows only lots inside the Waymo ODD', () => {
  const inOdd = makeLocation(IN_ODD_COORDS);
  const outOdd = makeLocation(OUT_ODD_COORDS);
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  assert.deepEqual(
    applyReviewFilters([inOdd, outOdd, noCoords], EMPTY_REVIEW_FILTERS).map((l) => l.id),
    [inOdd.id],
  );
});

test('applyReviewFilters odd: out shows only a confirmed-outside lot, not one with no coords', () => {
  const inOdd = makeLocation(IN_ODD_COORDS);
  const outOdd = makeLocation(OUT_ODD_COORDS);
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  assert.deepEqual(
    applyReviewFilters([inOdd, outOdd, noCoords], filters({ odd: 'out' })).map((l) => l.id),
    [outOdd.id],
  );
});

test('applyReviewFilters odd: all shows everything regardless of ODD status', () => {
  const inOdd = makeLocation(IN_ODD_COORDS);
  const outOdd = makeLocation(OUT_ODD_COORDS);
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  assert.deepEqual(
    applyReviewFilters([inOdd, outOdd, noCoords], filters({ odd: 'all' })).map((l) => l.id).sort(),
    [inOdd.id, noCoords.id, outOdd.id].sort(),
  );
});

// --- hasCoords ----------------------------------------------------------

test('applyReviewFilters hasCoords: default (all) shows everything', () => {
  const withCoords = makeLocation(IN_ODD_COORDS);
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  // odd: 'all' to isolate the hasCoords dimension — EMPTY_REVIEW_FILTERS'
  // own odd:'in' default would otherwise exclude noCoords on its own.
  assert.deepEqual(
    applyReviewFilters([withCoords, noCoords], filters({ odd: 'all' })).map((l) => l.id).sort(),
    [withCoords.id, noCoords.id].sort(),
  );
});

test('applyReviewFilters hasCoords: yes excludes lots with no lat/lng', () => {
  const withCoords = makeLocation(IN_ODD_COORDS);
  const noLat = makeLocation({ lat: undefined, lng: -112.074 });
  const noLng = makeLocation({ lat: 33.45, lng: undefined });
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  // odd: 'all' — otherwise the default odd:'in' would exclude the no-coords
  // fixtures on its own, masking whether hasCoords itself does anything.
  assert.deepEqual(
    applyReviewFilters([withCoords, noLat, noLng, noCoords], filters({ hasCoords: 'yes', odd: 'all' })).map((l) => l.id),
    [withCoords.id],
  );
});

test('applyReviewFilters hasCoords: no isolates only lots missing lat/lng', () => {
  const withCoords = makeLocation(IN_ODD_COORDS);
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  assert.deepEqual(
    applyReviewFilters([withCoords, noCoords], filters({ hasCoords: 'no', odd: 'all' })).map((l) => l.id),
    [noCoords.id],
  );
});

// --- combined (AND, not OR) -------------------------------------------------

test('applyReviewFilters: two+ filters combine with AND, not OR', () => {
  const a = makeLocation({ name: 'Brickell Garage', locality: 'Brickell', status: 'saved' });
  const b = makeLocation({ name: 'Brickell Lot', locality: 'Brickell', status: 'draft' });
  const c = makeLocation({ name: 'South Lot', locality: 'South Beach', status: 'saved' });

  const result = applyReviewFilters([a, b, c], filters({ locality: 'Brickell', status: 'saved' }));
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

test('applyReviewFilters: three combined filters narrow further than any subset', () => {
  const a = makeLocation({ name: 'Brickell Garage', locality: 'Brickell', status: 'saved', source_name: 'laz' });
  const b = makeLocation({ name: 'Brickell Garage', locality: 'Brickell', status: 'saved', source_name: 'spothero' });

  const result = applyReviewFilters(
    [a, b],
    filters({ search: 'brickell', locality: 'Brickell', status: 'saved', source_name: 'laz' }),
  );
  assert.deepEqual(result.map((l) => l.id), [a.id]);
});

// --- empty input -------------------------------------------------------------

test('applyReviewFilters: empty locations array returns empty', () => {
  assert.deepEqual(applyReviewFilters([], filters({ search: 'anything' })), []);
});

// --- hasActiveReviewFilters --------------------------------------------------

test('hasActiveReviewFilters: false for EMPTY_REVIEW_FILTERS', () => {
  assert.equal(hasActiveReviewFilters(EMPTY_REVIEW_FILTERS), false);
});

test('hasActiveReviewFilters: true when any single dimension is non-default', () => {
  assert.equal(hasActiveReviewFilters(filters({ search: 'x' })), true);
  assert.equal(hasActiveReviewFilters(filters({ locality: 'Brickell' })), true);
  assert.equal(hasActiveReviewFilters(filters({ status: 'saved' })), true);
  assert.equal(hasActiveReviewFilters(filters({ source_name: 'laz' })), true);
  assert.equal(hasActiveReviewFilters(filters({ flood: 'pass' })), true);
  assert.equal(hasActiveReviewFilters(filters({ residential: 'fail' })), true);
  assert.equal(hasActiveReviewFilters(filters({ added_by: 'Priya' })), true);
  assert.equal(hasActiveReviewFilters(filters({ odd: 'all' })), true);
  assert.equal(hasActiveReviewFilters(filters({ hasCoords: 'yes' })), true);
});

console.log('\nall reviewFilters tests passed');
