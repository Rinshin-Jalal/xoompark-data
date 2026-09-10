// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds fixtures shaped exactly like the real
// transport.tamu.edu/Parking/garages.aspx and visitor.aspx pages (captured
// 2026-08-25) through the pure parse/map functions in tamuParse.ts. Never
// imports tamu.ts or store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import { extractTamuGarages, extractTamuRateText, ingestTamuGarages, mapTamuGarageToInput } from '../tamuParse.ts';
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

// Real shape (trimmed) — garages.aspx's table.table-striped (Location |
// Clearance Levels) and visitor.aspx's Duration/Day/Night rate table.
const GARAGES_HTML = `<html><body>
<table class="table table-striped">
<thead><tr><th scope="col">Location</th><th scope="col">Clearance Levels</th></tr></thead>
<tbody>
<tr><td>Central Campus Garage</td><td>6' 8"</td></tr>
<tr><td>Gene Stallings Blvd. Garage</td><td>8' 2"</td></tr>
<tr><td>Polo Rd. Garage</td><td>8' 2"</td></tr>
</tbody>
</table>
</body></html>`;

const VISITOR_HTML = `<html><body>
<table class="table table-striped table-condensed">
<thead><tr><th>Duration</th><th>Day Rate</th><th>Night Rate</th></tr></thead>
<tbody>
<tr><td>Entry - 1 hr</td><td>$5</td><td>$2.50</td></tr>
<tr><td>1 hr - 2 hrs</td><td>$7</td><td>$3.50</td></tr>
</tbody>
</table>
</body></html>`;

test('extractTamuGarages: pulls name + clearance, skips the Location header row', () => {
  const garages = extractTamuGarages(GARAGES_HTML);
  assert.equal(garages.length, 3);
  assert.deepEqual(garages[0], { name: 'Central Campus Garage', clearanceText: '6\' 8"' });
  assert.equal(garages[2].name, 'Polo Rd. Garage');
});

test('extractTamuRateText: formats the Duration/Day/Night tiers', () => {
  assert.equal(
    extractTamuRateText(VISITOR_HTML),
    'Entry - 1 hr: $5 day / $2.50 night; 1 hr - 2 hrs: $7 day / $3.50 night',
  );
});

test('mapTamuGarageToInput: maps a garage + clearance + shared rate', () => {
  const [garage] = extractTamuGarages(GARAGES_HTML);
  const input = mapTamuGarageToInput(garage, 'Entry - 1 hr: $5 day / $2.50 night', 'https://transport.tamu.edu/Parking/garages.aspx');
  assert.ok(input);
  assert.equal(input!.source, 'texas-am');
  assert.equal(input!.name, 'Central Campus Garage');
  assert.equal(input!.clearanceText, '6\' 8"');
  assert.equal(input!.priceText, 'Entry - 1 hr: $5 day / $2.50 night');
  assert.equal(input!.sourceListingId, 'central-campus-garage');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.clearanceText, 'self-reported');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
});

// --- ingestTamuGarages: sweep aggregation ---
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

await test('ingestTamuGarages: maps every garage, shared rate applied to all', async () => {
  const store = makeFakeStore();
  const garages = extractTamuGarages(GARAGES_HTML);
  const rateText = extractTamuRateText(VISITOR_HTML);

  const result = await ingestTamuGarages('https://transport.tamu.edu/Parking/garages.aspx', garages, rateText, store.upsert);

  assert.equal(result.ingested, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 3);
});

console.log('\nall tamu tests passed');