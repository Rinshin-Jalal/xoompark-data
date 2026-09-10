// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real gachasparking.com
// #locations section (captured 2026-08-25) through the pure parse/map
// functions in gachasParse.ts. Never imports gachas.ts or store.ts.
import assert from 'node:assert/strict';
import { extractGachasLocations, ingestGachasLocations, mapGachasLocationToInput } from '../gachasParse.ts';
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

// Real shape (trimmed) — two <p>STREET,<br />CITY, STATE ZIP</p> blocks.
const FIXTURE_HTML = `<html><body>
<div id="locations">
<p>209 S Portland Ave,<br />Brooklyn, NY 11217</p>
<p>3306 88th Street<br />Jackson Heights, NY 11372</p>
</div>
</body></html>`;

test('extractGachasLocations: pulls each address block (address doubles as name)', () => {
  const locations = extractGachasLocations(FIXTURE_HTML);
  assert.equal(locations.length, 2);
  assert.deepEqual(locations[0], { name: '209 S Portland Ave, Brooklyn, NY 11217', address: '209 S Portland Ave, Brooklyn, NY 11217' });
  assert.equal(locations[1].name, '3306 88th Street Jackson Heights, NY 11372');
});

test('mapGachasLocationToInput: maps a location', () => {
  const [location] = extractGachasLocations(FIXTURE_HTML);
  const input = mapGachasLocationToInput(location, 'https://gachasparking.com/');
  assert.ok(input);
  assert.equal(input!.source, 'gachas');
  assert.equal(input!.name, '209 S Portland Ave, Brooklyn, NY 11217');
  assert.equal(input!.address, '209 S Portland Ave, Brooklyn, NY 11217');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.address, 'self-reported');
});

// --- ingestGachasLocations: sweep aggregation ---
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

await test('ingestGachasLocations: maps every location', async () => {
  const store = makeFakeStore();
  const locations = extractGachasLocations(FIXTURE_HTML);

  const result = await ingestGachasLocations('https://gachasparking.com/', locations, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall gachas tests passed');