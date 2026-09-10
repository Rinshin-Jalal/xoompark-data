// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds fixtures shaped exactly like the real iPark WP REST list
// and a garage detail page (captured 2026-08-25) through the pure parse/map
// functions in iparkParse.ts. Never imports ipark.ts or store.ts.
import assert from 'node:assert/strict';
import { extractIparkDetail, extractIparkGarages, ingestIparkGarages, mapIparkGarageToInput } from '../iparkParse.ts';
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

// Real shape (trimmed) — the wp/v2/garage list (name + link + slug; no
// address/hours) and one garage detail page's .info-line divs.
const FIXTURE_LIST = [
  { slug: '408-west-57th-parking-corp', link: 'https://ipark.com/garage/408-west-57th-parking-corp/', title: { rendered: '408 West 57th Parking Corp.' } },
  { slug: 'some-other', link: 'https://ipark.com/garage/some-other/', title: { rendered: 'Some Other Garage' } },
];

// Label sits inside its own <span>, value follows straight after the
// closing </span> (no whitespace) — verified against a live fetch of
// ipark.com/garage/408-west-57th-parking-corp/ on 2026-08-25. The prior
// version of this fixture (label+value in one text node, no <span>) didn't
// match the real page and let a broken extraction regex ship silently.
const FIXTURE_DETAIL = `<html><body>
<div class="info-line"><span>Address:</span>408 West 57th Street, NY, NY 10019<div class="info-line map-actions"><a>Get Directions</a> <a>View Map</a></div></div>
<div class="info-line"><span>Entrance:</span>408 West 57th Street, NY, NY 10019 and 409 W 56th Street</div>
<div class="info-line"><span>Hours:</span>24 Hours / 7 Days</div>
</body></html>`;

test('extractIparkGarages: pulls name/link/slug from the list', () => {
  const garages = extractIparkGarages(FIXTURE_LIST);
  assert.equal(garages.length, 2);
  assert.deepEqual(garages[0], {
    name: '408 West 57th Parking Corp.',
    link: 'https://ipark.com/garage/408-west-57th-parking-corp/',
    slug: '408-west-57th-parking-corp',
  });
});

test('extractIparkDetail: pulls address + hours, ignores the Entrance line', () => {
  const detail = extractIparkDetail(FIXTURE_DETAIL);
  assert.deepEqual(detail, { address: '408 West 57th Street, NY, NY 10019', hoursText: '24 Hours / 7 Days' });
});

test('mapIparkGarageToInput: maps a garage + detail', () => {
  const [garage] = extractIparkGarages(FIXTURE_LIST);
  const detail = extractIparkDetail(FIXTURE_DETAIL);
  const input = mapIparkGarageToInput({ garage, detail });
  assert.ok(input);
  assert.equal(input!.source, 'ipark');
  assert.equal(input!.name, '408 West 57th Parking Corp.');
  assert.equal(input!.address, '408 West 57th Street, NY, NY 10019');
  assert.equal(input!.hoursText, '24 Hours / 7 Days');
  assert.equal(input!.sourceUrl, 'https://ipark.com/garage/408-west-57th-parking-corp/');
  assert.equal(input!.sourceListingId, '408-west-57th-parking-corp');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.address, 'self-reported');
  assert.equal(input!.fieldProvenance!.hoursText, 'self-reported');
});

// --- ingestIparkGarages: sweep aggregation ---
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

await test('ingestIparkGarages: maps every entry', async () => {
  const store = makeFakeStore();
  const garages = extractIparkGarages(FIXTURE_LIST);
  const detail = extractIparkDetail(FIXTURE_DETAIL);
  const entries = garages.map((garage) => ({ garage, detail }));

  const result = await ingestIparkGarages(entries, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall ipark tests passed');