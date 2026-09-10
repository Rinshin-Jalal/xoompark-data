// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real
// pts.gatech.edu/parking/visitor-parking/ page (captured 2026-08-25) through
// the pure parse/map functions in gatechParse.ts. Never imports gatech.ts or
// store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import { extractGatechFacilities, ingestGatechFacilities, mapGatechFacilityToInput } from '../gatechParse.ts';
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

// Real shape (trimmed) — two wmd-heading accordion items, each followed by a
// "Hours and Pricing" table (header = time ranges, rows = day + rates).
const FIXTURE_HTML = `<html><body>
<div class="wmd-item"><div role="button" tabindex="0" aria-expanded="false" class="wmd-heading" >Visitor Area 4: State Street &amp; Ferst Drive</div><div class="wmd-content">
<h4><strong>Visitor Area 4 – State Street &amp; Ferst Drive</strong></h4>
<p><strong>This visitor lot requires that you pay when you park.</strong></p>
<table border="1"><thead><tr><th>Facility Type</th><th>Meter</th></tr></thead><tbody><tr><td>Parking Lot</td><td>Debit and Credit</td></tr></tbody></table>
<h4><strong>Hours and Pricing</strong></h4>
<table border="1">
<thead><tr><th></th><th>12:00 a.m.–5:59 a.m.</th><th>6:00 a.m.–7:59 p.m.</th><th>8:00 p.m.–11:59 p.m.</th></tr></thead>
<tbody><tr><th>Mon – Sun</th><td>$2/Hour (4 Hr Max)</td><td>$2/hr (4 hr max)</td><td>$2/Hour (4 Hr Max)</td></tr></tbody>
</table>
</div></div>
<div class="wmd-item"><div role="button" tabindex="0" aria-expanded="false" class="wmd-heading" >Visitor Area 11: Curran Deck (Rooftop Only)</div><div class="wmd-content">
<h4><strong>Hours and Pricing</strong></h4>
<table border="1">
<thead><tr><th></th><th>12:00 a.m. – 5:59 a.m.</th><th>6:00 a.m. – 7:59 p.m.</th></tr></thead>
<tbody><tr><th>Monday</th><td>$5 Flat Rate</td><td>$1/Hour (4 Hr Max)</td></tr></tbody>
</table>
</div></div>
</body></html>`;

test('extractGatechFacilities: pulls each wmd-heading name + its Hours and Pricing table', () => {
  const facilities = extractGatechFacilities(FIXTURE_HTML);
  assert.equal(facilities.length, 2);
  assert.equal(facilities[0].name, 'Visitor Area 4: State Street & Ferst Drive');
  assert.equal(
    facilities[0].priceText,
    'Mon – Sun: 12:00 a.m.–5:59 a.m. $2/Hour (4 Hr Max); 6:00 a.m.–7:59 p.m. $2/hr (4 hr max); 8:00 p.m.–11:59 p.m. $2/Hour (4 Hr Max)',
  );
  assert.equal(facilities[1].name, 'Visitor Area 11: Curran Deck (Rooftop Only)');
  assert.equal(facilities[1].priceText, 'Monday: 12:00 a.m. – 5:59 a.m. $5 Flat Rate; 6:00 a.m. – 7:59 p.m. $1/Hour (4 Hr Max)');
});

test('mapGatechFacilityToInput: maps a facility + rate', () => {
  const [facility] = extractGatechFacilities(FIXTURE_HTML);
  const input = mapGatechFacilityToInput(facility, 'https://www.pts.gatech.edu/parking/visitor-parking/');
  assert.ok(input);
  assert.equal(input!.source, 'georgia-tech');
  assert.equal(input!.name, 'Visitor Area 4: State Street & Ferst Drive');
  assert.equal(input!.sourceListingId, 'visitor-area-4-state-street-ferst-drive');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
});

// --- ingestGatechFacilities: sweep aggregation ---
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

await test('ingestGatechFacilities: maps every facility', async () => {
  const store = makeFakeStore();
  const facilities = extractGatechFacilities(FIXTURE_HTML);

  const result = await ingestGatechFacilities('https://www.pts.gatech.edu/parking/visitor-parking/', facilities, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall gatech tests passed');