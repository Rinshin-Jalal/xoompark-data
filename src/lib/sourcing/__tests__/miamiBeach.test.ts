// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real Miami Beach
// parking-garage-rates page (captured 2026-08-25) through the pure
// parse/map functions in miamiBeachParse.ts. Never imports miamiBeach.ts or
// store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import {
  buildRateScheduleText,
  extractMiamiBeachGarages,
  ingestGarages,
  mapGarageToInput,
} from '../miamiBeachParse.ts';
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

// Real shape (trimmed) — <h3> garage heading followed by one <table> whose
// cells are <span class="content-text">. Two garages: one with an even
// number of rate cells (pure HOURS/RATE pairs), one with an odd trailing
// summary cell ("Maximum Daily Rate ... | Lost Ticket ...").
const FIXTURE_HTML = `<html><body>
<h3>7th Street Garage</h3>
<p><a href="#map">View on Map</a></p>
<table class="uabb-table-inner-wrap">
<thead><tr><th><span>HOURS</span></th><th><span>RATE</span></th></tr></thead>
<tbody>
<tr><td><span class="content-text"> 0 TO 1 </span></td><td><span class="content-text"> $2.00 </span></td></tr>
<tr><td><span class="content-text"> 1 TO 2 </span></td><td><span class="content-text"> $4.00 </span></td></tr>
</tbody>
</table>
<h3>5th &amp; Alton</h3>
<table class="uabb-table-inner-wrap">
<tbody>
<tr><td><span class="content-text"> 0 TO 1 </span></td><td><span class="content-text"> $2.00 </span></td></tr>
<tr><td><span class="content-text"> Maximum Daily Rate $20 | Lost Ticket $30 </span></td></tr>
</tbody>
</table>
</body></html>`;

test('extractMiamiBeachGarages: pulls each h3 name + its rate cells', () => {
  const garages = extractMiamiBeachGarages(FIXTURE_HTML);
  assert.equal(garages.length, 2);
  assert.equal(garages[0].name, '7th Street Garage');
  assert.deepEqual(garages[0].rateCells, ['0 TO 1', '$2.00', '1 TO 2', '$4.00']);
  assert.equal(garages[1].name, '5th & Alton'); // &amp; decoded
  assert.deepEqual(garages[1].rateCells, ['0 TO 1', '$2.00', 'Maximum Daily Rate $20 | Lost Ticket $30']);
});

test('buildRateScheduleText: pairs HOURS/RATE, appends odd trailing summary cell', () => {
  assert.equal(buildRateScheduleText(['0 TO 1', '$2.00', '1 TO 2', '$4.00']), '0 TO 1: $2.00, 1 TO 2: $4.00');
  assert.equal(
    buildRateScheduleText(['0 TO 1', '$2.00', 'Maximum Daily Rate $20 | Lost Ticket $30']),
    '0 TO 1: $2.00 | Maximum Daily Rate $20 | Lost Ticket $30',
  );
  assert.equal(buildRateScheduleText([]), undefined);
});

test('mapGarageToInput: maps a garage block, sourceUrl is page#slug', () => {
  const [garage] = extractMiamiBeachGarages(FIXTURE_HTML);
  const input = mapGarageToInput(garage, 'https://www.miamibeachfl.gov/rates/');
  assert.ok(input);
  assert.equal(input!.source, 'miami-beach');
  assert.equal(input!.name, '7th Street Garage');
  assert.equal(input!.sourceUrl, 'https://www.miamibeachfl.gov/rates/#7th-street-garage');
  assert.equal(input!.sourceListingId, '7th-street-garage');
  assert.equal(input!.priceText, '0 TO 1: $2.00, 1 TO 2: $4.00');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.name, 'self-reported');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
});

// --- ingestGarages: sweep aggregation over already-parsed blocks ---
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

await test('ingestGarages: maps every garage block', async () => {
  const store = makeFakeStore();
  const garages = extractMiamiBeachGarages(FIXTURE_HTML);

  const result = await ingestGarages('https://www.miamibeachfl.gov/rates/', garages, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall miamiBeach tests passed');