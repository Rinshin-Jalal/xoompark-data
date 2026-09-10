// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real
// sylvanparking.com/locations-rates.html page (captured 2026-08-25) through
// the pure parse/map functions in sylvanParse.ts. Never imports sylvan.ts or
// store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import { extractSylvanRows, ingestSylvanRows, mapSylvanRowToInput } from '../sylvanParse.ts';
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

// Real shape (trimmed) — table.simple-table with GARAGE | ADDRESS | PHONE
// NUMBER columns. Address cells carry nbsp + zero-width-space chars.
const FIXTURE_HTML = `<html><body>
<table class="simple-table style-top">
<thead><tr><th>GARAGE</th><th>ADDRESS</th><th>PHONE NUMBER</th></tr></thead>
<tbody>
<tr><td>SYLVAN SKY GARAGE</td><td>700\u00a0FIRST\u00a0ST.\u200bHOBOKEN, NJ 07030\u200b</td><td>(201) 239-8002</td></tr>
<tr><td>SYLVAN HUDSON PARKING</td><td>\u200b\u200b315 14th Street\u200bJERSEY CITY, NJ 07310</td><td>(201) 425-9640</td></tr>
</tbody>
</table>
</body></html>`;

test('extractSylvanRows: pulls name/address/phone, skips the GARAGE header row', () => {
  const rows = extractSylvanRows(FIXTURE_HTML);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    name: 'SYLVAN SKY GARAGE',
    address: '700 FIRST ST. HOBOKEN, NJ 07030',
    phone: '(201) 239-8002',
  });
});

test('mapSylvanRowToInput: maps a row, phone stays in rawInput only', () => {
  const [row] = extractSylvanRows(FIXTURE_HTML);
  const input = mapSylvanRowToInput(row, 'https://sylvanparking.com/locations-rates.html');
  assert.ok(input);
  assert.equal(input!.source, 'sylvan');
  assert.equal(input!.name, 'SYLVAN SKY GARAGE');
  assert.equal(input!.address, '700 FIRST ST. HOBOKEN, NJ 07030');
  assert.equal(input!.sourceListingId, 'sylvan-sky-garage');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.address, 'self-reported');
  assert.equal((input!.rawInput as { phone?: string }).phone, '(201) 239-8002');
});

// --- ingestSylvanRows: sweep aggregation ---
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

await test('ingestSylvanRows: maps every row', async () => {
  const store = makeFakeStore();
  const rows = extractSylvanRows(FIXTURE_HTML);

  const result = await ingestSylvanRows('https://sylvanparking.com/locations-rates.html', rows, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall sylvan tests passed');