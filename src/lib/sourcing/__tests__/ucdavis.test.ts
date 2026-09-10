// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real
// health.ucdavis.edu/parking/visitor/ page (captured 2026-08-25) through the
// pure parse/map functions in ucdavisParse.ts. Never imports ucdavis.ts or
// store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import { extractUcdavisFacilities, ingestUcdavisFacilities, mapUcdavisFacilityToInput } from '../ucdavisParse.ts';
import { buildUpsertDoc, computeDedupeKey, normalizeAddress } from '../types.ts';
import type { SourcedLocationInput, SourcedParkingLocation } from '../types.ts';

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// Real shape (trimmed) — one table per facility; the first row names it
// (one or two cells), the body's <p> text is the rate. "Extended Parking
// Options" is an <h4> in the body, not a facility, so it's not captured.
const FIXTURE_HTML = `<html><body>
<table border="1"><tbody>
<tr><td><h4><strong>Parking Structure 3 Rate</strong></h4></td></tr>
<tr><td><p>$2.00 per 1/2 hour ($18.00 daily maximum)</p></td></tr>
<tr><td><h4>Extended Parking Options</h4></td></tr>
<tr><td><p>$20.00 24-Hour Pass</p></td></tr>
</tbody></table>
<table border="1"><tbody>
<tr><td class="text-center">Lot 8 Parking Rate</td><td class="text-center">Lot 11 Parking Rate</td></tr>
<tr><td><p>$2.00 per 1/2 hour (4.0 hour maximum time limit)</p><p>$16.00 maximum</p></td><td><p>$2.00 per 1/2 hour (4.0 hour maximum time limit)</p><p>$16.00 maximum</p></td></tr>
</tbody></table>
<table border="1"><tbody>
<tr><td class="text-center">Parking Structure 2 Parking Rate</td></tr>
<tr><td><p>$2.00 per 1/2 hour</p><p>$18.00 daily maximum</p></td></tr>
</tbody></table>
</body></html>`;

test('extractUcdavisFacilities: one facility per header cell, "Rate" suffix stripped', () => {
  const facilities = extractUcdavisFacilities(FIXTURE_HTML);
  assert.equal(facilities.length, 4);
  assert.deepEqual(facilities.map((f) => f.name), [
    'Parking Structure 3',
    'Lot 8',
    'Lot 11',
    'Parking Structure 2',
  ]);
  assert.equal(facilities[0].priceText, '$2.00 per 1/2 hour ($18.00 daily maximum); $20.00 24-Hour Pass');
});

test('mapUcdavisFacilityToInput: maps a facility + rate', () => {
  const [facility] = extractUcdavisFacilities(FIXTURE_HTML);
  const input = mapUcdavisFacilityToInput(facility, 'https://health.ucdavis.edu/parking/visitor/');
  assert.ok(input);
  assert.equal(input!.source, 'uc-davis-health');
  assert.equal(input!.name, 'Parking Structure 3');
  assert.equal(input!.sourceListingId, 'parking-structure-3');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
});

// --- ingestUcdavisFacilities: sweep aggregation ---
function makeFakeStore() {
  const docs = new Map<string, SourcedParkingLocation>();
  const upsert = async (input: SourcedLocationInput): Promise<SourcedParkingLocation> => {
    const normalizedAddress = input.normalizedAddress ?? (input.address ? normalizeAddress(input.address) : undefined);
    const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
    const existing = docs.get(id) ?? null;
    const doc = buildUpsertDoc(existing, input, '2026-08-25T00:00:00.000Z');
    docs.set(id, doc);
    return doc;
  };
  return { docs, upsert };
}

await test('ingestUcdavisFacilities: maps every facility', async () => {
  const store = makeFakeStore();
  const facilities = extractUcdavisFacilities(FIXTURE_HTML);

  const result = await ingestUcdavisFacilities('https://health.ucdavis.edu/parking/visitor/', facilities, store.upsert);

  assert.equal(result.ingested, 4);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 4);
});

console.log('\nall ucdavis tests passed');