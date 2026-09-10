// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds the real committed pdftotext extraction of Greg's PDF
// (data/greg/master-listing.txt) through the pure parse/map functions in
// gregMasterParse.ts. Never imports store.ts ('server-only').
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGregMasterListing, rowToInput, surfaceTypeFromName, geocodeQueries } from '../gregMasterParse.ts';
import { computeDedupeKey } from '../types.ts';

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const text = readFileSync(new URL('../../../../data/greg/master-listing.txt', import.meta.url), 'utf8');
const { rows, errors } = parseGregMasterListing(text);

test('parses all 104 rows with zero errors', () => {
  assert.equal(rows.length, 104);
  assert.deepEqual(errors, []);
});

test('location codes are unique (dedupe keys cannot collide)', () => {
  assert.equal(new Set(rows.map((r) => r.loc)).size, 104);
});

test('RM001 blank city is fixed from the PDF prefix key, mgr kept', () => {
  const rm = rows.find((r) => r.loc === 'RM001')!;
  assert.equal(rm.city, 'Chicago');
  assert.equal(rm.state, 'IL');
  assert.equal(rm.mgr, 'IP Natl');
  assert.equal(rm.oml, undefined);
});

test('CH379 row with no O/M/L and no Mgr parses cleanly', () => {
  const ch = rows.find((r) => r.loc === 'CH379')!;
  assert.equal(ch.name, 'Wolf Point Driveway');
  assert.equal(ch.oml, undefined);
  assert.equal(ch.mgr, undefined);
});

test('multi-word Mgr column survives as one field', () => {
  assert.equal(rows.find((r) => r.loc === 'ML607')!.mgr, 'Interstate');
  assert.equal(rows.find((r) => r.loc === 'RM001')!.mgr, 'IP Natl');
});

test('state-column typos are preserved verbatim (CL=IL, SL=MI), zip disambiguates geocoding', () => {
  assert.equal(rows.find((r) => r.loc === 'CL001')!.state, 'IL');
  assert.equal(rows.find((r) => r.loc === 'SL001')!.state, 'MI');
  assert.ok(geocodeQueries(rows.find((r) => r.loc === 'CL001')!)[0].includes('44114'));
});

test('surfaceTypeFromName: only unambiguous names map', () => {
  assert.equal(surfaceTypeFromName('Harbor Garage'), 'structured');
  assert.equal(surfaceTypeFromName('TJU Surface Lot (9c)'), 'surface');
  assert.equal(surfaceTypeFromName('236 Williams St Lot & Garage'), undefined);
  assert.equal(surfaceTypeFromName('PreFlight Atlanta'), undefined);
  assert.equal(surfaceTypeFromName('Love Park'), undefined);
});

test('rowToInput: shape, provenance, dedupe key', () => {
  const input = rowToInput(rows.find((r) => r.loc === 'CH410')!, 41.892, -87.624);
  assert.equal(input.source, 'greg-master-listing-july-2026');
  assert.equal(input.sourceListingId, 'CH410');
  assert.equal(input.capturedBy, 'scraped');
  assert.equal(input.surfaceType, 'structured');
  assert.equal(input.fieldProvenance?.name, 'self-reported');
  assert.equal(input.fieldProvenance?.surfaceType, 'self-reported');
  assert.equal(input.fieldProvenance?.lat, 'self-reported');
  assert.equal(computeDedupeKey(input), 'greg-master-listing-july-2026:CH410');
  // operator + O/M/L ride in rawInput — no schema field for them
  assert.deepEqual((input.rawInput as { oml?: string }).oml, 'M');
  assert.equal(rows.find((r) => r.loc === 'AT029')!.mgr, 'SP+');
});

test('rowToInput: ungeocoded row has no lat/lng provenance and no guessed fields', () => {
  const input = rowToInput(rows.find((r) => r.loc === 'AT029')!);
  assert.equal(input.lat, undefined);
  assert.equal(input.fieldProvenance?.lat, undefined);
  assert.equal(input.surfaceType, 'surface');
  assert.equal(input.capacityText, undefined);
  assert.equal(input.stallsTotal, undefined);
});
