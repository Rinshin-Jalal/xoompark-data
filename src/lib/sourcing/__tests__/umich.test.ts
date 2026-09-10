// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real UMich
// campus-visitor-parking page (Wayback snapshot 2026-07-31, captured
// 2026-08-25) through the pure parse/map functions in umichParse.ts. Never
// imports umich.ts or store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import {
  extractUmichLotRows,
  extractUmichPriceText,
  ingestUmichLots,
  mapUmichLotToInput,
} from '../umichParse.ts';
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

// Real shape (trimmed) — intro prose stating the shared hourly rate, then
// two plain <table>s (no class) with Lot | Name | Address | Enforcement
// Hours columns. Header rows use <th> (skipped); data rows use <td>.
const FIXTURE_HTML = `<html><body>
<p>Parking fees are $2.60 per hour. The maximum hours of use and enforcement hours, which vary by location, are posted in the location listings.</p>
<table>
<thead><tr><th>Lot</th><th>Lot/Structure Name</th><th>Address</th><th>Enforcement Hours</th></tr></thead>
<tbody>
<tr><td>E2</td><td><a href="/lot/?xyz=1">Hadley Family Recreation Building</a></td><td>1308 N. University Street</td><td>24 hrs, 7 days</td></tr>
<tr><td>E16</td><td>1443 Washtenaw Avenue Bldg</td><td>1443 Washtenaw Ave</td><td>6am – 6pm, Mon – Fri</td></tr>
</tbody>
</table>
<table>
<thead><tr><th>Lot</th><th>Name</th><th>Address</th><th>Enforcement Hours</th></tr></thead>
<tbody>
<tr><td>N26</td><td>Palmer Drive Structure</td><td>200 Washtenaw Ave.</td><td>24 hrs a day, 7 days a week</td></tr>
</tbody>
</table>
</body></html>`;

test('extractUmichLotRows: walks every table, skips th header rows', () => {
  const rows = extractUmichLotRows(FIXTURE_HTML);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    lot: 'E2',
    name: 'Hadley Family Recreation Building',
    address: '1308 N. University Street',
    hoursText: '24 hrs, 7 days',
  });
  assert.equal(rows[2].name, 'Palmer Drive Structure');
});

test('extractUmichPriceText: pulls the shared hourly rate from intro prose', () => {
  assert.equal(extractUmichPriceText(FIXTURE_HTML), '$2.60 per hour');
});

test('mapUmichLotToInput: maps a lot row + shared rate, sourceUrl is page#slug', () => {
  const [row] = extractUmichLotRows(FIXTURE_HTML);
  const input = mapUmichLotToInput(row, 'https://web.archive.org/web/20260731184213/https://ltp.umich.edu/...', '$2.60 per hour');
  assert.ok(input);
  assert.equal(input!.source, 'umich');
  assert.equal(input!.name, 'Hadley Family Recreation Building');
  assert.equal(input!.address, '1308 N. University Street');
  assert.equal(input!.hoursText, '24 hrs, 7 days');
  assert.equal(input!.priceText, '$2.60 per hour');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.name, 'self-reported');
  assert.equal(input!.fieldProvenance!.address, 'self-reported');
  assert.equal(input!.fieldProvenance!.hoursText, 'self-reported');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
});

test('mapUmichLotToInput: missing name -> null', () => {
  assert.equal(mapUmichLotToInput({ lot: 'X', address: '1 Main St' }, 'https://x', undefined), null);
});

// --- ingestUmichLots: sweep aggregation over already-parsed rows ---
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

await test('ingestUmichLots: maps every row, shared priceText applied to all', async () => {
  const store = makeFakeStore();
  const rows = extractUmichLotRows(FIXTURE_HTML);
  const priceText = extractUmichPriceText(FIXTURE_HTML);

  const result = await ingestUmichLots('https://page', rows, priceText, store.upsert);

  assert.equal(result.ingested, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 3);
});

console.log('\nall umich tests passed');