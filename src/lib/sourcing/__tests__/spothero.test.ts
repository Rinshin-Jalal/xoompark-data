// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real __NEXT_DATA__
// blob (captured from spothero.com/destination/miami/downtown-miami-parking
// on 2026-08-23) through the pure parse/map functions in spotheroParse.ts.
//
// Multi-page sweep tests below use ingestFeaturedSpots (also in
// spotheroParse.ts) with an injected in-memory fake upsert built on the real
// buildUpsertDoc/computeDedupeKey from types.ts — both Firestore-free, so
// this file never imports spothero.ts or store.ts ('server-only' would
// throw under plain node outside a react-server condition).
import assert from 'node:assert/strict';
import {
  extractFeaturedSpots,
  extractNextData,
  ingestFeaturedSpots,
  mapFeaturedSpotToInput,
} from '../spotheroParse.ts';
import type { SpotHeroFeaturedSpot } from '../spotheroParse.ts';
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

// Real shape, trimmed to the fields we read. Second spot has no
// spotId/slug (SpotHero occasionally omits these on partial listings) to
// exercise the skip path. Third has no rate, to exercise missing priceText.
const FIXTURE_HTML = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      featuredSpots: [
        {
          spotId: '92951',
          title: '100 SE 2nd St. - James L. Knight Center Garage',
          slug: '100-se-2nd-st',
          addresses: [
            {
              streetAddress: '100 Southeast 2nd Street',
              city: 'Miami',
              state: 'FL',
              postalCode: '33131',
              latitude: 25.77255,
              longitude: -80.191057,
              types: ['search', 'walking_distance', 'default_vehicle_entrance'],
            },
            {
              streetAddress: '100 Southeast 2nd Street',
              city: 'Miami',
              state: 'FL',
              postalCode: '33131',
              latitude: 25.772085,
              longitude: -80.191299,
              types: ['physical'],
            },
          ],
          selectedRate: {
            advertisedPrice: { currencyCode: 'USD', value: 1500 },
            starts: '2026-08-23T06:00:00-04:00',
            ends: '2026-08-23T10:00:00-04:00',
          },
        },
        {
          title: 'Missing id/slug lot',
          addresses: [{ streetAddress: '1 Nowhere Ave', city: 'Miami', state: 'FL' }],
        },
        {
          spotId: '8436',
          title: '60 SE 2nd St',
          slug: '60-se-2nd-st',
          addresses: [{ streetAddress: '60 Southeast 2nd Street', city: 'Miami', state: 'FL', types: ['physical'] }],
        },
      ],
    },
  },
})}</script></head><body></body></html>`;

test('extractNextData: pulls JSON from the script tag', () => {
  const data = extractNextData(FIXTURE_HTML);
  assert.ok(data && typeof data === 'object');
});

test('extractNextData: throws when tag is absent', () => {
  assert.throws(() => extractNextData('<html><body>no data here</body></html>'));
});

test('extractFeaturedSpots: reads pageProps.featuredSpots, 3 raw entries', () => {
  const spots = extractFeaturedSpots(extractNextData(FIXTURE_HTML));
  assert.equal(spots.length, 3);
});

test('mapFeaturedSpotToInput: maps a full listing, priceText preserved verbatim', () => {
  const spots = extractFeaturedSpots(extractNextData(FIXTURE_HTML));
  const input = mapFeaturedSpotToInput(spots[0]);
  assert.ok(input);
  assert.equal(input!.source, 'spothero');
  assert.equal(input!.sourceListingId, '92951');
  assert.equal(input!.sourceUrl, 'https://spothero.com/facility/92951/100-se-2nd-st-parking');
  assert.equal(input!.name, '100 SE 2nd St. - James L. Knight Center Garage');
  assert.equal(input!.address, '100 Southeast 2nd Street, Miami, FL 33131');
  assert.equal(input!.lat, 25.772085); // picks the 'physical' address, not 'search'
  assert.equal(input!.priceText, '$15.00 (4hr)'); // raw text, not reformatted into $/hr
  assert.equal(input!.capturedBy, 'scraped');
});

test('mapFeaturedSpotToInput: every captured field is self-reported provenance', () => {
  const spots = extractFeaturedSpots(extractNextData(FIXTURE_HTML));
  const input = mapFeaturedSpotToInput(spots[0])!;
  for (const field of ['name', 'address', 'lat', 'lng', 'priceText']) {
    assert.equal(input.fieldProvenance![field], 'self-reported', `${field} provenance`);
  }
});

test('mapFeaturedSpotToInput: missing spotId/slug -> null (caller counts as skipped)', () => {
  const spots = extractFeaturedSpots(extractNextData(FIXTURE_HTML));
  const input = mapFeaturedSpotToInput(spots[1]);
  assert.equal(input, null);
});

test('mapFeaturedSpotToInput: missing rate -> priceText left undefined, listing still ingested', () => {
  const spots = extractFeaturedSpots(extractNextData(FIXTURE_HTML));
  const input = mapFeaturedSpotToInput(spots[2]);
  assert.ok(input);
  assert.equal(input!.priceText, undefined);
  assert.equal(input!.fieldProvenance!.priceText, undefined);
  assert.equal(input!.sourceUrl, 'https://spothero.com/facility/8436/60-se-2nd-st-parking');
});

// --- multi-page sweep aggregation ---
// ingestFeaturedSpots is the same core the real sweep uses per page (see
// spothero.ts's ingestOnePage) — only the upsert is swapped for an
// in-memory fake built on the real buildUpsertDoc/computeDedupeKey, so
// these tests exercise the actual dedupe/evidence logic, not a reimplementation.

function spotFixture(spotId: string, slug: string, title: string): SpotHeroFeaturedSpot {
  return {
    spotId,
    slug,
    title,
    addresses: [{ streetAddress: `${spotId} Test St`, city: 'Miami', state: 'FL', latitude: 25.77, longitude: -80.19, types: ['physical'] }],
  };
}

function makeFakeStore() {
  const docs = new Map<string, SourcedParkingLocation>();
  const upsert = async (input: SourcedLocationInput): Promise<SourcedParkingLocation> => {
    const normalizedAddress = input.normalizedAddress ?? (input.address ? normalizeAddress(input.address) : undefined);
    const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
    const existing = docs.get(id) ?? null;
    const doc = buildUpsertDoc(existing, input, '2026-08-23T00:00:00.000Z');
    docs.set(id, doc);
    return doc;
  };
  return { docs, upsert };
}

await test('ingestFeaturedSpots: multi-page aggregate counting, overlapping listingId across pages', async () => {
  const store = makeFakeStore();
  const pageA = [spotFixture('111', 'lot-a', 'Lot A'), spotFixture('222', 'lot-b', 'Lot B')];
  const pageB = [
    spotFixture('222', 'lot-b', 'Lot B'), // overlaps page A
    spotFixture('333', 'lot-c', 'Lot C'),
    { title: 'missing id/slug' }, // exercises the skip path
  ];

  const resultA = await ingestFeaturedSpots('https://page-a', pageA, store.upsert);
  const resultB = await ingestFeaturedSpots('https://page-b', pageB, store.upsert);

  assert.equal(resultA.ingested, 2);
  assert.equal(resultA.skipped, 0);
  assert.equal(resultB.ingested, 2); // 222 (dupe) + 333
  assert.equal(resultB.skipped, 1); // the missing id/slug entry

  // 4 listing-encounters ingested total, but only 3 unique docs — 222 was
  // seen on both pages and correctly collapsed by the dedupe key.
  assert.equal(resultA.ingested + resultB.ingested, 4);
  assert.equal(store.docs.size, 3);
});

await test('ingestFeaturedSpots: same listing on two pages -> one doc, evidence stays exactly 1 entry', async () => {
  const store = makeFakeStore();
  const spot = spotFixture('222', 'lot-b', 'Lot B');

  await ingestFeaturedSpots('https://page-a', [spot], store.upsert);
  await ingestFeaturedSpots('https://page-b', [spot], store.upsert);

  assert.equal(store.docs.size, 1);
  const doc = store.docs.get('spothero:222')!;
  // Both pages are the same source ('spothero'), so the second upsert must
  // not append a second evidence entry — that's buildUpsertDoc's real
  // hasSource check in types.ts, not anything reimplemented here.
  assert.equal(doc.evidence.length, 1);
});

console.log('\nall spothero tests passed');
