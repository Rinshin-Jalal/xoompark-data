// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds fixtures shaped exactly like the real Secure HI sitemap
// and a location CPT page (captured 2026-08-25) through the pure parse/map
// functions in securehiParse.ts. Never imports securehi.ts or store.ts.
import assert from 'node:assert/strict';
import {
  extractSecurehiLocation,
  extractSecurehiLocationUrls,
  ingestSecurehiLocations,
  mapSecurehiLocationToInput,
} from '../securehiParse.ts';
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

const FIXTURE_SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc>https://www.secureparkinghi.com/parking-location/hawaii-office/</loc></url>
<url><loc>https://www.secureparkinghi.com/parking-location/moiliili-professional-building/</loc></url>
</urlset>`;

// Real shape (trimmed) — <h1> name, #locationmap data_lat/data_lng, and the
// address <p> whose first line is the "Secure Parking …" operator name.
const FIXTURE_PAGE = `<html><body>
<div id="locationmap" class="wpsl-map" data_lat="21.298218" data_lng="-157.8573803"></div>
<div class="location-details">
<h1>Hawaii Office</h1>
<p><strong>529 Koula Street, Bay 2</strong></p>
<p>
Secure Parking Hawaii Office<br>
529 Koula Street, Bay 2<br>Honolulu, HI 96813</p>
</div>
</body></html>`;

test('extractSecurehiLocationUrls: pulls every loc from the sitemap', () => {
  const urls = extractSecurehiLocationUrls(FIXTURE_SITEMAP);
  assert.deepEqual(urls, [
    'https://www.secureparkinghi.com/parking-location/hawaii-office/',
    'https://www.secureparkinghi.com/parking-location/moiliili-professional-building/',
  ]);
});

test('extractSecurehiLocation: name/address/lat-lng, operator line dropped', () => {
  const location = extractSecurehiLocation(FIXTURE_PAGE, 'https://www.secureparkinghi.com/parking-location/hawaii-office/');
  assert.equal(location.name, 'Hawaii Office');
  assert.equal(location.address, '529 Koula Street, Bay 2, Honolulu, HI 96813');
  assert.equal(location.lat, 21.298218);
  assert.equal(location.lng, -157.8573803);
});

test('mapSecurehiLocationToInput: maps a location, slug from URL', () => {
  const location = extractSecurehiLocation(FIXTURE_PAGE, 'https://www.secureparkinghi.com/parking-location/hawaii-office/');
  const input = mapSecurehiLocationToInput(location);
  assert.ok(input);
  assert.equal(input!.source, 'secure-parking-hi');
  assert.equal(input!.name, 'Hawaii Office');
  assert.equal(input!.address, '529 Koula Street, Bay 2, Honolulu, HI 96813');
  assert.equal(input!.lat, 21.298218);
  assert.equal(input!.lng, -157.8573803);
  assert.equal(input!.sourceListingId, 'hawaii-office');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.lat, 'self-reported');
});

// --- ingestSecurehiLocations: sweep aggregation ---
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

await test('ingestSecurehiLocations: maps every location', async () => {
  const store = makeFakeStore();
  const locations = [
    extractSecurehiLocation(FIXTURE_PAGE, 'https://www.secureparkinghi.com/parking-location/hawaii-office/'),
    extractSecurehiLocation(FIXTURE_PAGE, 'https://www.secureparkinghi.com/parking-location/moiliili-professional-building/'),
  ];

  const result = await ingestSecurehiLocations(locations, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall securehi tests passed');