// Plain assert-based test runnable with `node --experimental-strip-types`.
// Covers stripClearanceIfSurface inside buildUpsertDoc: surfaceType='surface'
// can never coexist with clearanceText on a doc the upsert path returns
// (fleet-API data integrity — a wrong clearance can damage a vehicle).
// Retro-fix for the pre-guard prod records: scripts/fix_surface_clearance.ts.
import assert from 'node:assert/strict';
import { buildUpsertDoc, type SourcedLocationInput, type SourcedParkingLocation } from '../types.ts';

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
  sourceUrl: 'https://spothero.com/listing/12345',
  sourceListingId: '12345',
  capturedBy: 'scraped',
  rawInput: { raw: true },
};

// ── create path ──────────────────────────────────────────────────────────────

test('create: surface + clearance input -> clearance stripped, provenance dropped', () => {
  const doc = buildUpsertDoc(null, { ...baseInput, surfaceType: 'surface', clearanceText: "6'8\"" }, '2026-09-04T00:00:00.000Z');
  assert.equal(doc.surface_type, 'surface');
  assert.equal(doc.clearance_text, undefined);
  assert.equal(doc.field_sources.clearance_text, undefined);
});

test('create: structured + clearance -> kept (the sane combo)', () => {
  const doc = buildUpsertDoc(null, { ...baseInput, surfaceType: 'structured', clearanceText: "6'8\"" }, '2026-09-04T00:00:00.000Z');
  assert.equal(doc.clearance_text, "6'8\"");
});

// ── merge path ───────────────────────────────────────────────────────────────

test('merge: incoming clearance onto an existing surface lot -> stripped (fill-then-guard)', () => {
  const existing = buildUpsertDoc(null, { ...baseInput, surfaceType: 'surface' }, '2026-09-04T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, { ...baseInput, source: 'osm', clearanceText: "7'0\"" }, '2026-09-05T00:00:00.000Z');
  assert.equal(merged.surface_type, 'surface');
  assert.equal(merged.clearance_text, undefined);
});

test('merge: legacy surface+clearance doc self-heals on the next upsert', () => {
  // Simulate a pre-guard prod doc: surface + clearance set directly.
  const legacy = buildUpsertDoc(null, { ...baseInput, surfaceType: 'structured', clearanceText: "6'8\"" }, '2026-09-04T00:00:00.000Z');
  const poisoned: SourcedParkingLocation = { ...legacy, surface_type: 'surface' };
  const merged = buildUpsertDoc(poisoned, { ...baseInput, source: 'osm' }, '2026-09-05T00:00:00.000Z');
  assert.equal(merged.clearance_text, undefined);
  assert.equal(merged.field_sources.clearance_text, undefined);
});

test('merge: existing structured + incoming surface+clearance -> structured wins, clearance kept', () => {
  const existing = buildUpsertDoc(null, { ...baseInput, surfaceType: 'structured' }, '2026-09-04T00:00:00.000Z');
  const merged = buildUpsertDoc(existing, { ...baseInput, source: 'osm', surfaceType: 'surface', clearanceText: "6'8\"" }, '2026-09-05T00:00:00.000Z');
  // surfaceType conflicts -> existing 'structured' survives (never-overwrite)
  assert.equal(merged.surface_type, 'structured');
  assert.equal(merged.clearance_text, "6'8\"");
});

console.log('\nall surface-clearance tests passed');
