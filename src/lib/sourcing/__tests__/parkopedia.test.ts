// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds fixtures shaped exactly like the real data-react-props
// blob (captured from en.parkopedia.com/parking/miami_fl/ on 2026-08-23)
// through the pure parse/map/match functions in parkopediaParse.ts.
import assert from 'node:assert/strict';
import {
  addressSimilarity,
  classifyCrossSourceMatch,
  extractLocations,
  extractReactProps,
  findCrossSourceMatches,
  haversineMeters,
  mapLocationToInput,
} from '../parkopediaParse.ts';
import type { SourcedParkingLocation } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// Real shape, trimmed to the fields we read. Second location has no url
// (Parkopedia occasionally has partial entries) to exercise the skip path.
// Third has no rates/hours, to exercise missing priceText/hoursText.
const LOCATIONS_JSON = [
  {
    id: 7816167,
    geometry: {
      geometries: [
        { type: 'Point', coordinates: [-80.227567, 25.795521] },
        { type: 'LineString', coordinates: [[-80.2277, 25.7955], [-80.2276, 25.7955]] },
      ],
    },
    properties: {
      dynamic: { rates: [{ price_text: '$3.50' }] },
      static: {
        name: '1891 Northwest 21st Street',
        address: ['Miami Parking Authority', '1891 Northwest 21st Street', 'Central Downtown', 'Miami, FL 33142'],
        url: 'https://en.parkopedia.com/parking/meter/1891_northwest_21st_street/33142/miami/',
        times: { open: [{ day_text: 'Mon-Sun', from: '0000', to: '2400' }] },
      },
    },
  },
  {
    id: 999,
    geometry: { geometries: [{ type: 'Point', coordinates: [-80.19, 25.77] }] },
    properties: {
      dynamic: { rates: [] },
      static: { name: 'Missing url lot', address: ['1 Nowhere Ave', 'Miami, FL'] },
    },
  },
  {
    id: 5555,
    geometry: { geometries: [{ type: 'Point', coordinates: [-80.191057, 25.77255] }] },
    properties: {
      dynamic: {},
      static: {
        name: '100 SE 2nd St Garage',
        address: ['100 Southeast 2nd Street', 'Miami, FL 33131'],
        url: 'https://en.parkopedia.com/parking/garage/100_se_2nd_st/33131/miami/',
      },
    },
  },
];

const FIXTURE_HTML = `<html><body><div data-react-props='${JSON.stringify({
  locations: { all: LOCATIONS_JSON },
})
  .replace(/&/g, '&amp;')
  .replace(/'/g, '&#039;')
  .replace(/"/g, '&quot;')}'></div></body></html>`;

test('extractReactProps: pulls JSON from the data-react-props attribute', () => {
  const props = extractReactProps(FIXTURE_HTML);
  assert.ok(props && typeof props === 'object');
});

test('extractReactProps: throws when attribute is absent', () => {
  assert.throws(() => extractReactProps('<html><body>no data here</body></html>'));
});

test('extractLocations: reads locations.all, 3 raw entries', () => {
  const locations = extractLocations(extractReactProps(FIXTURE_HTML));
  assert.equal(locations.length, 3);
});

test('mapLocationToInput: maps a full listing, priceText and hoursText preserved verbatim', () => {
  const locations = extractLocations(extractReactProps(FIXTURE_HTML));
  const input = mapLocationToInput(locations[0]);
  assert.ok(input);
  assert.equal(input!.source, 'parkopedia');
  assert.equal(input!.sourceListingId, '7816167');
  assert.equal(input!.sourceUrl, 'https://en.parkopedia.com/parking/meter/1891_northwest_21st_street/33142/miami/');
  assert.equal(input!.name, '1891 Northwest 21st Street');
  assert.equal(input!.address, 'Miami Parking Authority, 1891 Northwest 21st Street, Central Downtown, Miami, FL 33142');
  assert.equal(input!.lat, 25.795521); // picks the Point geometry, not the LineString
  assert.equal(input!.lng, -80.227567);
  assert.equal(input!.priceText, '$3.50'); // raw text, not reformatted
  assert.equal(input!.hoursText, 'Mon-Sun 00:00-24:00');
  assert.equal(input!.capturedBy, 'scraped');
});

test('mapLocationToInput: every captured field is self-reported provenance', () => {
  const locations = extractLocations(extractReactProps(FIXTURE_HTML));
  const input = mapLocationToInput(locations[0])!;
  for (const field of ['name', 'address', 'lat', 'lng', 'price_text', 'hours_text']) {
    assert.equal(input.fieldProvenance![field], 'self-reported', `${field} provenance`);
  }
});

test('mapLocationToInput: missing sourceUrl -> null (caller counts as skipped)', () => {
  const locations = extractLocations(extractReactProps(FIXTURE_HTML));
  const input = mapLocationToInput(locations[1]);
  assert.equal(input, null);
});

test('mapLocationToInput: missing rates/hours -> priceText/hoursText left undefined, listing still ingested', () => {
  const locations = extractLocations(extractReactProps(FIXTURE_HTML));
  const input = mapLocationToInput(locations[2]);
  assert.ok(input);
  assert.equal(input!.priceText, undefined);
  assert.equal(input!.hoursText, undefined);
  assert.equal(input!.fieldProvenance!.price_text, undefined);
  assert.equal(input!.sourceUrl, 'https://en.parkopedia.com/parking/garage/100_se_2nd_st/33131/miami/');
});

// --- cross-source match probe ---

function stubRecord(overrides: Partial<SourcedParkingLocation>): SourcedParkingLocation {
  return {
    id: 'stub',
    name: 'stub',
    source_name: 'stub',
    source_url: 'https://example.com',
    evidence: [],
    field_sources: {},
    captured_by: 'scraped',
    status: 'draft',
    raw_input: null,
    created_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

test('haversineMeters: zero distance for identical points', () => {
  assert.equal(haversineMeters({ lat: 25.77, lng: -80.19 }, { lat: 25.77, lng: -80.19 }), 0);
});

test('addressSimilarity: identical normalized addresses score 1', () => {
  assert.equal(addressSimilarity('100 se 2nd street miami fl', '100 se 2nd street miami fl'), 1);
});

test('findCrossSourceMatches: reports a match for near-identical address + <50m pin', () => {
  const parkopediaRecords = [
    stubRecord({
      id: 'parkopedia:5555',
      source_name: 'parkopedia',
      normalized_address: '100 southeast 2nd street miami fl 33131',
      lat: 25.772085,
      lng: -80.191057,
    }),
  ];
  const spotheroRecords = [
    stubRecord({
      id: 'spothero:92951',
      source_name: 'spothero',
      normalized_address: '100 southeast 2nd street miami fl 33131',
      // ~9m away — same building, different pin capture (search vs physical)
      lat: 25.77201,
      lng: -80.191057,
    }),
  ];
  const matches = findCrossSourceMatches(parkopediaRecords, spotheroRecords);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].parkopediaId, 'parkopedia:5555');
  assert.equal(matches[0].spotheroId, 'spothero:92951');
  assert.ok(matches[0].distanceMeters < 50, `expected <50m, got ${matches[0].distanceMeters}`);
  assert.equal(matches[0].addressSimilarity, 1);
});

test('findCrossSourceMatches: no match beyond 50m', () => {
  const parkopediaRecords = [
    stubRecord({ id: 'parkopedia:1', source: 'parkopedia', normalized_address: 'a', lat: 25.77, lng: -80.19 }),
  ];
  const spotheroRecords = [
    stubRecord({ id: 'spothero:1', source: 'spothero', normalized_address: 'a', lat: 25.80, lng: -80.19 }),
  ];
  const matches = findCrossSourceMatches(parkopediaRecords, spotheroRecords);
  assert.equal(matches.length, 0);
});

// --- verdict classification ---

test('classifyCrossSourceMatch: identical address + <50m -> confident', () => {
  const parkopediaRecords = [
    stubRecord({
      id: 'parkopedia:5555',
      source_name: 'parkopedia',
      normalized_address: '100 southeast 2nd street miami fl 33131',
      lat: 25.772085,
      lng: -80.191057,
    }),
  ];
  const spotheroRecords = [
    stubRecord({
      id: 'spothero:92951',
      source_name: 'spothero',
      normalized_address: '100 southeast 2nd street miami fl 33131',
      lat: 25.77201,
      lng: -80.191057,
    }),
  ];
  const [match] = findCrossSourceMatches(parkopediaRecords, spotheroRecords);
  assert.ok(match);
  assert.equal(classifyCrossSourceMatch(match), 'confident');
});

test('classifyCrossSourceMatch: <50m apart but dissimilar addresses -> ambiguous', () => {
  const parkopediaRecords = [
    stubRecord({
      id: 'parkopedia:1',
      source_name: 'parkopedia',
      normalized_address: '100 southeast 2nd street miami fl 33131',
      lat: 25.772085,
      lng: -80.191057,
    }),
  ];
  const spotheroRecords = [
    stubRecord({
      id: 'spothero:1',
      source_name: 'spothero',
      // Same pin (0m away) but an unrelated address string — e.g. a garage
      // and an adjacent meter sharing a lat/lng capture.
      normalized_address: 'totally different unrelated address',
      lat: 25.772085,
      lng: -80.191057,
    }),
  ];
  const [match] = findCrossSourceMatches(parkopediaRecords, spotheroRecords);
  assert.ok(match);
  assert.ok(match.distanceMeters < 50);
  assert.ok(match.addressSimilarity < 0.5, `expected <0.5, got ${match.addressSimilarity}`);
  assert.equal(classifyCrossSourceMatch(match), 'ambiguous');
});

// --- real live-probe pairs (2026-08-23 sourcing run) ---

test('classifyCrossSourceMatch: shared "Lot 18" label with no street match -> confident', () => {
  // spothero:94167 vs parkopedia:401186 — 3.4m apart, same lot, but one
  // side is a bare "Municipal Lot 18" with no street number/name at all.
  const parkopediaRecords = [
    stubRecord({
      id: 'parkopedia:401186',
      source_name: 'parkopedia',
      normalized_address: 'Municipal Lot 18',
      lat: 25.77209,
      lng: -80.19106,
    }),
  ];
  const spotheroRecords = [
    stubRecord({
      id: 'spothero:94167',
      source_name: 'spothero',
      normalized_address: '1320 NW 12th St - Lot 18',
      lat: 25.77210, // ~3.4m away
      lng: -80.19106,
    }),
  ];
  const [match] = findCrossSourceMatches(parkopediaRecords, spotheroRecords);
  assert.ok(match);
  assert.ok(match.distanceMeters < 50, `expected <50m, got ${match.distanceMeters}`);
  assert.equal(classifyCrossSourceMatch(match), 'confident');
});

test('classifyCrossSourceMatch: same street name, different street number -> ambiguous', () => {
  // spothero:15898 vs parkopedia:2498819 — plausibly two different
  // addresses on the same street, not confirmed to be the same lot.
  const parkopediaRecords = [
    stubRecord({
      id: 'parkopedia:2498819',
      source_name: 'parkopedia',
      normalized_address: '710 SW 16th Ave',
      lat: 25.76,
      lng: -80.2,
    }),
  ];
  const spotheroRecords = [
    stubRecord({
      id: 'spothero:15898',
      source_name: 'spothero',
      normalized_address: '701 SW 16th Ave',
      lat: 25.76001, // well under 50m
      lng: -80.2,
    }),
  ];
  const [match] = findCrossSourceMatches(parkopediaRecords, spotheroRecords);
  assert.ok(match);
  assert.ok(match.distanceMeters < 50, `expected <50m, got ${match.distanceMeters}`);
  assert.equal(classifyCrossSourceMatch(match), 'ambiguous');
});

console.log('\nall parkopedia tests passed');
