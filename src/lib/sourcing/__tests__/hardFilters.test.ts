// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers the two now-real hard-filter checks (notResidentialAdjacent,
// aboveFloodPlain) and the failed-hard-filter-sinks-to-bottom sort order.
// Same Firestore/'server-only'-free split as the rest of __tests__ — only
// imports hardFilters.ts, which only imports types.ts.
import assert from 'node:assert/strict';
import { evaluateHardFilter, hasHardFail, sortForReview } from '../hardFilters.ts';
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
    ...overrides,
  };
}

// --- notResidentialAdjacent ------------------------------------------------

test('evaluateHardFilter notResidentialAdjacent: missing geoContext -> unknown', () => {
  const loc = makeLocation();
  assert.equal(evaluateHardFilter(loc, 'notResidentialAdjacent').result, 'unknown');
});

test('evaluateHardFilter notResidentialAdjacent: residentialAdjacent true -> fail (inverted, adjacency is bad)', () => {
  const loc = makeLocation({ enrichment: { geo: { residentialAdjacent: true, checkedAt: 'x' } } });
  assert.equal(evaluateHardFilter(loc, 'notResidentialAdjacent').result, 'fail');
});

test('evaluateHardFilter notResidentialAdjacent: residentialAdjacent false -> pass', () => {
  const loc = makeLocation({ enrichment: { geo: { residentialAdjacent: false, checkedAt: 'x' } } });
  assert.equal(evaluateHardFilter(loc, 'notResidentialAdjacent').result, 'pass');
});

test('evaluateHardFilter notResidentialAdjacent: geoContext present but field itself missing -> unknown', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: false, checkedAt: 'x' } } });
  assert.equal(evaluateHardFilter(loc, 'notResidentialAdjacent').result, 'unknown');
});

// --- aboveFloodPlain --------------------------------------------------------

test('evaluateHardFilter aboveFloodPlain: missing geoContext -> unknown', () => {
  const loc = makeLocation();
  assert.equal(evaluateHardFilter(loc, 'aboveFloodPlain').result, 'unknown');
});

test('evaluateHardFilter aboveFloodPlain: floodHazardArea true -> fail, detail carries zone letter', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: true, floodZone: 'AE', checkedAt: 'x' } } });
  const result = evaluateHardFilter(loc, 'aboveFloodPlain');
  assert.equal(result.result, 'fail');
  assert.equal(result.detail, 'Zone AE');
});

test('evaluateHardFilter aboveFloodPlain: floodHazardArea true, no zone letter -> fail, no detail', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: true, floodZone: null, checkedAt: 'x' } } });
  const result = evaluateHardFilter(loc, 'aboveFloodPlain');
  assert.equal(result.result, 'fail');
  assert.equal(result.detail, undefined);
});

test('evaluateHardFilter aboveFloodPlain: floodHazardArea false -> pass', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: false, checkedAt: 'x' } } });
  assert.equal(evaluateHardFilter(loc, 'aboveFloodPlain').result, 'pass');
});

// --- the other 6 columns stay unknown regardless of geoContext -------------

test('evaluateHardFilter: schema-less keys (e.g. dedicatedStalls) always unknown, even with geoContext set', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: false, residentialAdjacent: false, checkedAt: 'x' } } });
  assert.equal(evaluateHardFilter(loc, 'dedicatedStalls').result, 'unknown');
  assert.equal(evaluateHardFilter(loc, 'open247').result, 'unknown');
});

// --- #34: schema-backed keys (open247/is_fenced/is_lit/fiftyPlusStalls/ingress) ---

test('evaluateHardFilter open247: tri-state map true/false/null/undefined -> pass/fail/unknown/unknown', () => {
  assert.equal(evaluateHardFilter(makeLocation({ is_24_7: true }), 'open247').result, 'pass');
  assert.equal(evaluateHardFilter(makeLocation({ is_24_7: false }), 'open247').result, 'fail');
  assert.equal(evaluateHardFilter(makeLocation({ is_24_7: null }), 'open247').result, 'unknown');
  assert.equal(evaluateHardFilter(makeLocation(), 'open247').result, 'unknown');
});

test('evaluateHardFilter is_fenced/is_lit: same tri-state map', () => {
  assert.equal(evaluateHardFilter(makeLocation({ is_fenced: true }), 'is_fenced').result, 'pass');
  assert.equal(evaluateHardFilter(makeLocation({ is_fenced: false }), 'is_fenced').result, 'fail');
  assert.equal(evaluateHardFilter(makeLocation({ is_fenced: null }), 'is_fenced').result, 'unknown');
  assert.equal(evaluateHardFilter(makeLocation({ is_lit: true }), 'is_lit').result, 'pass');
  assert.equal(evaluateHardFilter(makeLocation({ is_lit: false }), 'is_lit').result, 'fail');
  assert.equal(evaluateHardFilter(makeLocation(), 'is_lit').result, 'unknown');
});

test('evaluateHardFilter fiftyPlusStalls: stall_count >= 50 -> pass, < 50 -> fail, no number -> unknown', () => {
  assert.equal(evaluateHardFilter(makeLocation({ stall_count: 62 }), 'fiftyPlusStalls').result, 'pass');
  assert.equal(evaluateHardFilter(makeLocation({ stall_count: 12 }), 'fiftyPlusStalls').result, 'fail');
  assert.equal(evaluateHardFilter(makeLocation({ stall_count: null }), 'fiftyPlusStalls').result, 'unknown');
  assert.equal(evaluateHardFilter(makeLocation(), 'fiftyPlusStalls').result, 'unknown');
});

test('evaluateHardFilter ingress_egressControlled: recorded text -> pass (with detail), empty/null -> unknown', () => {
  const pass = evaluateHardFilter(makeLocation({ ingress_egress: 'one-way in' }), 'ingress_egressControlled');
  assert.equal(pass.result, 'pass');
  assert.equal(pass.detail, 'one-way in');
  assert.equal(evaluateHardFilter(makeLocation({ ingress_egress: '' }), 'ingress_egressControlled').result, 'unknown');
  assert.equal(evaluateHardFilter(makeLocation(), 'ingress_egressControlled').result, 'unknown');
});

test('evaluateHardFilter: Phase II keys (dedicatedStalls, cellCoverage) still always unknown', () => {
  const loc = makeLocation({ is_fenced: true, is_24_7: true });
  assert.equal(evaluateHardFilter(loc, 'dedicatedStalls').result, 'unknown');
  assert.equal(evaluateHardFilter(loc, 'cellCoverage').result, 'unknown');
});

// --- hasHardFail -------------------------------------------------------------

test('hasHardFail: true when the flood check fails', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: true, residentialAdjacent: false, checkedAt: 'x' } } });
  assert.equal(hasHardFail(loc), true);
});

test('hasHardFail: true when the residential check fails', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: false, residentialAdjacent: true, checkedAt: 'x' } } });
  assert.equal(hasHardFail(loc), true);
});

test('hasHardFail: false when both real checks pass (rest are unknown, not fail)', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: false, residentialAdjacent: false, checkedAt: 'x' } } });
  assert.equal(hasHardFail(loc), false);
});

test('hasHardFail: false when geoContext is entirely missing (everything unknown)', () => {
  assert.equal(hasHardFail(makeLocation()), false);
});

// --- sortForReview -----------------------------------------------------------

test('sortForReview: failed records sink to the bottom, created_at-desc preserved within each group', () => {
  const passA = makeLocation({ id: 'passA', created_at: '2026-08-20T00:00:00.000Z' });
  const passB = makeLocation({ id: 'passB', created_at: '2026-08-22T00:00:00.000Z' });
  const failA = makeLocation({
    id: 'failA',
    created_at: '2026-08-23T00:00:00.000Z',
    enrichment: { geo: { floodHazardArea: true, checkedAt: 'x' } },
  });
  const failB = makeLocation({
    id: 'failB',
    created_at: '2026-08-21T00:00:00.000Z',
    enrichment: { geo: { residentialAdjacent: true, checkedAt: 'x' } },
  });

  // Deliberately scrambled input order.
  const sorted = sortForReview([failA, passA, failB, passB]);

  assert.deepEqual(
    sorted.map((l) => l.id),
    ['passB', 'passA', 'failA', 'failB'],
  );
});

test('sortForReview: unknown-only records (no geoContext) count as not-failed, sort by created_at like today', () => {
  const older = makeLocation({ id: 'older', created_at: '2026-08-01T00:00:00.000Z' });
  const newer = makeLocation({ id: 'newer', created_at: '2026-08-10T00:00:00.000Z' });
  const sorted = sortForReview([older, newer]);
  assert.deepEqual(sorted.map((l) => l.id), ['newer', 'older']);
});

test('sortForReview: does not mutate the input array', () => {
  const a = makeLocation({ id: 'a', created_at: '2026-08-01T00:00:00.000Z' });
  const b = makeLocation({ id: 'b', created_at: '2026-08-10T00:00:00.000Z' });
  const input = [a, b];
  sortForReview(input);
  assert.deepEqual(input.map((l) => l.id), ['a', 'b']);
});

console.log('\nall hardFilters tests passed');
