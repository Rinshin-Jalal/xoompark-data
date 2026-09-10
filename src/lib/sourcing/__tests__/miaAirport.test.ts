// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real
// miami-airport.com/airport-parking.asp page (captured 2026-08-25) through
// the pure parse/map functions in miaAirportParse.ts. Never imports
// miaAirport.ts or store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import {
  extractGarageNames,
  extractRateRows,
  formatRateText,
  ingestMiaGarages,
  mapGarageToInput,
} from '../miaAirportParse.ts';
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

// Real shape (trimmed) — the "Parking Location / Accessible Parking / Van
// Accessible Parking" table (garage names in the first <td> of each row) and
// the class="table table-sm" rate table (one campus-wide rate).
const FIXTURE_HTML = `<html><body>
<table style="border-collapse: collapse;" width="500">
<thead>
<tr><td scope="col"><strong><span>Parking Location</span></strong></td><td scope="col"><strong><span>Accessible Parking&nbsp;</span></strong></td><td scope="col"><strong><span>Van Accessible Parking</span></strong></td></tr>
</thead>
<tbody>
<tr><td>Dolphin Garage</td><td>Ground Level &amp; Level 3</td><td>Ground Level&nbsp;</td></tr>
<tr><td>Flamingo Garage</td><td>Ground Level &amp; Level 3</td><td>Ground Level&nbsp;</td></tr>
<tr><td>Ibis Garage</td><td>Ground Level &amp; Level 3</td><td>Ground Level&nbsp;</td></tr>
<tr><td>Park 1</td><td>Ground Level</td><td>Ground Level&nbsp;</td></tr>
</tbody>
</table>
<table class="table table-sm" border="0">
<tbody>
<tr><th class="t-des" scope="row">Each 20 minute increment</th><td class="money-large">$2.00</td></tr>
<tr><th class="t-des" scope="row">Maximum Daily Rate</th><td class="money-large">$25.00</td></tr>
<tr class="table-info"><td colspan="2"><p>Maximum rate applies after 4 hours.</p></td></tr>
</tbody>
</table>
</body></html>`;

test('extractGarageNames: pulls the 4 garage names from the accessible-parking table', () => {
  const names = extractGarageNames(FIXTURE_HTML);
  assert.deepEqual(names, ['Dolphin Garage', 'Flamingo Garage', 'Ibis Garage', 'Park 1']);
});

test('extractGarageNames: no marker -> []', () => {
  assert.deepEqual(extractGarageNames('<html><body>nothing</body></html>'), []);
});

test('extractRateRows: pulls label/amount pairs, skips the table-info note row', () => {
  const rows = extractRateRows(FIXTURE_HTML);
  assert.deepEqual(rows, [
    { label: 'Each 20 minute increment', amount: '$2.00' },
    { label: 'Maximum Daily Rate', amount: '$25.00' },
  ]);
});

test('formatRateText: joins label: amount pairs verbatim', () => {
  const rows = extractRateRows(FIXTURE_HTML);
  assert.equal(formatRateText(rows), 'Each 20 minute increment: $2.00; Maximum Daily Rate: $25.00');
});

test('mapGarageToInput: maps a garage name + shared rate, sourceUrl is page#slug', () => {
  const input = mapGarageToInput('Dolphin Garage', '$2.00', 'https://www.miami-airport.com/airport-parking.asp');
  assert.ok(input);
  assert.equal(input!.source, 'mia-airport');
  assert.equal(input!.name, 'Dolphin Garage');
  assert.equal(input!.sourceUrl, 'https://www.miami-airport.com/airport-parking.asp#dolphin-garage');
  assert.equal(input!.sourceListingId, 'dolphin-garage');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.name, 'self-reported');
});

test('mapGarageToInput: empty name -> null', () => {
  assert.equal(mapGarageToInput('', undefined, 'https://x'), null);
});

// --- ingestMiaGarages: sweep aggregation over already-parsed names ---
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

await test('ingestMiaGarages: maps every garage name, shared priceText applied to all', async () => {
  const store = makeFakeStore();
  const names = extractGarageNames(FIXTURE_HTML);
  const priceText = formatRateText(extractRateRows(FIXTURE_HTML));

  const result = await ingestMiaGarages('https://www.miami-airport.com/airport-parking.asp', names, priceText, store.upsert);

  assert.equal(result.ingested, 4);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 4);
  const dolphin = store.docs.get('mia-airport:dolphin-garage')!;
  assert.equal(dolphin.price_text, 'Each 20 minute increment: $2.00; Maximum Daily Rate: $25.00');
});

console.log('\nall miaAirport tests passed');