// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real Palmetto Google
// My Maps KML export (captured 2026-08-25) through the pure parse/map
// functions in palmettoParse.ts. Never imports palmetto.ts or store.ts.
import assert from 'node:assert/strict';
import { extractPalmettoPlacemarks, ingestPalmettoPlacemarks, mapPlacemarkToInput } from '../palmettoParse.ts';
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

// Real shape (trimmed) — <Placemark> with <name> (lot number), <description>
// ("ADDRESS - HOURS", sometimes CDATA-wrapped), and <coordinates> "lng,lat,0".
const FIXTURE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>001</name><description>65 Hasell Street  - Parking available  anytime</description><Point><coordinates>-79.931335,32.782448,0</coordinates></Point></Placemark>
<Placemark><name>004</name><description><![CDATA[14 Cumberland St  -  Monday thru Friday 5 pm to 7 am and All Day Saturday & Sunday]]></description><Point><coordinates>-79.9275879,32.7800521,0</coordinates></Point></Placemark>
</Document></kml>`;

test('extractPalmettoPlacemarks: pulls name/description/coords from each placemark', () => {
  const placemarks = extractPalmettoPlacemarks(FIXTURE_KML);
  assert.equal(placemarks.length, 2);
  assert.equal(placemarks[0].name, '001');
  assert.equal(placemarks[0].description, '65 Hasell Street - Parking available anytime');
  assert.equal(placemarks[0].lat, 32.782448);
  assert.equal(placemarks[0].lng, -79.931335);
});

test('mapPlacemarkToInput: address doubles as name, hours tail becomes hoursText', () => {
  const [pm] = extractPalmettoPlacemarks(FIXTURE_KML);
  const input = mapPlacemarkToInput(pm);
  assert.ok(input);
  assert.equal(input!.source, 'palmetto');
  assert.equal(input!.name, '65 Hasell Street');
  assert.equal(input!.address, '65 Hasell Street');
  assert.equal(input!.hoursText, 'Parking available anytime');
  assert.equal(input!.lat, 32.782448);
  assert.equal(input!.lng, -79.931335);
  assert.equal(input!.sourceListingId, '001');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.hoursText, 'self-reported');
});

test('mapPlacemarkToInput: CDATA description also parsed', () => {
  const [, pm] = extractPalmettoPlacemarks(FIXTURE_KML);
  const input = mapPlacemarkToInput(pm);
  assert.equal(input!.name, '14 Cumberland St');
  assert.equal(input!.hoursText, 'Monday thru Friday 5 pm to 7 am and All Day Saturday & Sunday');
});

// --- ingestPalmettoPlacemarks: sweep aggregation ---
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

await test('ingestPalmettoPlacemarks: maps every placemark', async () => {
  const store = makeFakeStore();
  const placemarks = extractPalmettoPlacemarks(FIXTURE_KML);

  const result = await ingestPalmettoPlacemarks(placemarks, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall palmetto tests passed');