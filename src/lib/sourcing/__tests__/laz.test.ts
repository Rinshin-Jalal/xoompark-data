// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds real Firecrawl markdown responses (captured from
// lazparking.com/local/miami-fl/wynwood-garage and
// lazparking.com/local/miami-beach-fl/500-collins on 2026-08-24, trimmed to
// the structural sections actually parsed — the privacy-policy banner and
// cookie-modal boilerplate at the top/bottom of every LAZ page carry no
// parsed fields and are dropped for fixture readability) through the pure
// parse/map functions in lazParse.ts. Never imports laz.ts or store.ts
// ('server-only' would throw under plain node outside a react-server
// condition) — and never touches FIRECRAWL_API_KEY, which this file has no
// reason to reference at all.
import assert from 'node:assert/strict';
import {
  ingestLazFacilities,
  mapLazFacilityToInput,
  parseLazFacility,
} from '../lazParse.ts';
import type { LazFacilityPage } from '../lazParse.ts';
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

// Real shape (trimmed, see header) — has a "Permit address:" line, distinct
// from the facility's own street address, and "Open 24/7" hours.
const WYNWOOD_MARKDOWN = `
GEO SearchSearch

Hourly Parking

Monthly Parking


# Wynwood Garage

- Buy Parking

- Map
- Image

![Wynwood Garage](https://xpark.lazparking.com//api/v1/Photo/3498202)

## Address

321 NW 26th St


Permit address: 2660 NW 3rd Ave


Miami,
FL
33127


[Get Directions](https://maps.google.com/maps?f=d&hl=en&geocode=&z=16&daddr=25.801612+-80.2015459)

General Location Information:


[(786) 355-8505](tel:(786) 355-8505)

## Hours of Operation

|     |     |
| --- | --- |
| Open 24/7 |  |

## Parking Services

- Indoor Self-Park
- Open 24/7
- Accepts Cash
`;

// Real shape (trimmed) — no "Permit address:" line, so the address block is
// exactly 4 raw lines.
const COLLINS_MARKDOWN = `
GEO SearchSearch

Hourly Parking

Monthly Parking


# 500 Collins Avenue

- Buy Parking

- Map
- Image

![500 Collins Avenue](https://xpark.lazparking.com//api/v1/Photo/3497632)

## Address

500 Collins Avenue


Miami Beach,
FL
33131


[Get Directions](https://maps.google.com/maps?f=d&hl=en&geocode=&z=16&daddr=25.7747424+-80.1334571)

General Location Information:


[(305) 538-6061](tel:(305) 538-6061)

## Hours of Operation

|     |     |
| --- | --- |
| Open 24/7 |  |

## Parking Services

- Indoor Self-Park
- Open 24/7
- Accepts Credit Cards
- Accepts Cash
`;

test('parseLazFacility: wynwood — name/address (permit line dropped)/lat-lng/hours', () => {
  const listing = parseLazFacility({ url: 'https://www.lazparking.com/local/miami-fl/wynwood-garage', markdown: WYNWOOD_MARKDOWN });
  assert.equal(listing.name, 'Wynwood Garage');
  assert.equal(listing.address, '321 NW 26th St, Miami, FL 33127');
  assert.equal(listing.lat, 25.801612);
  assert.equal(listing.lng, -80.2015459);
  assert.equal(listing.hoursText, 'Open 24/7');
  assert.equal(listing.priceText, undefined); // no rate on this page — never fabricated
});

// Real shape observed during the live Miami ingest (2026-08-24) —
// plaza-57.lazparking.com uses the abbreviated "Permit Add:" wording instead
// of "Permit address:", which the initial parser missed (it only matched the
// unabbreviated form) and let leak into the stored address. Regression fixture.
const PLAZA57_MARKDOWN = `
# Plaza 57

## Address

7300 SW 57th Court


Permit Add: 7301 SW 57th Court


South Miami
FL
33143


[Get Directions](https://maps.google.com/maps?f=d&hl=en&geocode=&z=16&daddr=25.6867+-80.3151)

## Hours of Operation

|     |     |
| --- | --- |
| Open 24/7 |  |
`;

test('parseLazFacility: plaza 57 — abbreviated "Permit Add:" line also dropped', () => {
  const listing = parseLazFacility({ url: 'https://www.lazparking.com/local/south-miami-fl/plaza-57', markdown: PLAZA57_MARKDOWN });
  assert.equal(listing.address, '7300 SW 57th Court, South Miami, FL 33143');
});

test('parseLazFacility: 500 collins — no permit line, same shape', () => {
  const listing = parseLazFacility({ url: 'https://www.lazparking.com/local/miami-beach-fl/500-collins', markdown: COLLINS_MARKDOWN });
  assert.equal(listing.name, '500 Collins Avenue');
  assert.equal(listing.address, '500 Collins Avenue, Miami Beach, FL 33131');
  assert.equal(listing.lat, 25.7747424);
  assert.equal(listing.lng, -80.1334571);
  assert.equal(listing.hoursText, 'Open 24/7');
});

test('mapLazFacilityToInput: maps a full listing, sourceListingId from LAZ URL path', () => {
  const listing = parseLazFacility({ url: 'https://www.lazparking.com/local/miami-fl/wynwood-garage', markdown: WYNWOOD_MARKDOWN });
  const input = mapLazFacilityToInput(listing);
  assert.ok(input);
  assert.equal(input!.source, 'laz');
  assert.equal(input!.sourceUrl, 'https://www.lazparking.com/local/miami-fl/wynwood-garage');
  assert.equal(input!.sourceListingId, 'miami-fl-wynwood-garage');
  assert.equal(input!.name, 'Wynwood Garage');
  assert.equal(input!.hoursText, 'Open 24/7');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.rawInput, listing);
});

test('mapLazFacilityToInput: every captured field is self-reported provenance', () => {
  const listing = parseLazFacility({ url: 'https://www.lazparking.com/local/miami-fl/wynwood-garage', markdown: WYNWOOD_MARKDOWN });
  const input = mapLazFacilityToInput(listing)!;
  for (const field of ['name', 'address', 'lat', 'lng', 'hoursText']) {
    assert.equal(input.fieldProvenance![field], 'self-reported', `${field} provenance`);
  }
  // priceText was never captured on this listing — must not appear at all.
  assert.equal(input.fieldProvenance!.priceText, undefined);
});

test('mapLazFacilityToInput: missing url -> null (caller counts as skipped)', () => {
  const input = mapLazFacilityToInput({ url: '', name: 'Some Garage', address: '1 Main St' });
  assert.equal(input, null);
});

test('mapLazFacilityToInput: url that does not match /local/<city>/<facility> falls back to slugifyCity(name-address)', () => {
  const input = mapLazFacilityToInput({
    url: 'https://www.lazparking.com/locations/weird-path',
    name: 'Odd Garage',
    address: '1 Main St, Miami, FL 33101',
  });
  assert.ok(input);
  assert.equal(input!.sourceListingId, 'odd-garage-1-main-st-miami-fl-33101');
});

// --- ingestLazFacilities: sweep aggregation over already-fetched pages ---
// Firestore-free (upsert is an injected in-memory fake built on the real
// buildUpsertDoc/computeDedupeKey), so this exercises the actual
// dedupe/evidence logic, not a reimplementation — same pattern as
// spothero.test.ts's makeFakeStore.

function makeFakeStore() {
  const docs = new Map<string, SourcedParkingLocation>();
  const upsert = async (input: SourcedLocationInput): Promise<SourcedParkingLocation> => {
    const normalizedAddress = input.normalizedAddress ?? (input.address ? normalizeAddress(input.address) : undefined);
    const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
    const existing = docs.get(id) ?? null;
    const doc = buildUpsertDoc(existing, input, '2026-08-24T00:00:00.000Z');
    docs.set(id, doc);
    return doc;
  };
  return { docs, upsert };
}

await test('ingestLazFacilities: mapping count from a fixture batch, missing-url page skipped', async () => {
  const store = makeFakeStore();
  const pages: LazFacilityPage[] = [
    { url: 'https://www.lazparking.com/local/miami-fl/wynwood-garage', markdown: WYNWOOD_MARKDOWN },
    { url: 'https://www.lazparking.com/local/miami-beach-fl/500-collins', markdown: COLLINS_MARKDOWN },
    { url: '', markdown: '# No URL Garage' }, // exercises the skip path
  ];

  const result = await ingestLazFacilities(pages, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
  assert.ok(store.docs.has('laz:miami-fl-wynwood-garage'));
  assert.ok(store.docs.has('laz:miami-beach-fl-500-collins'));
});

console.log('\nall laz tests passed');
