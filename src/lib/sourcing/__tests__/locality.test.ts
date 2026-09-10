// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers deriveLocality's keyword matching (clean hits, a clear miss, and a
// genuine ambiguous case) plus the pure locality-tracker counting logic
// (isEnriched, localityStats, countUnassignedLocality). Same Firestore/
// 'server-only'-free split as the rest of __tests__ — only imports
// locality.ts, which only imports types.ts.
import assert from 'node:assert/strict';
import { countUnassignedLocality, deriveLocality, isEnriched, LOCALITIES, LOCALITY_CENTERS, localityStats } from '../locality.ts';
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

let seq = 0;
function makeLocation(overrides: Partial<SourcedParkingLocation> = {}): SourcedParkingLocation {
  seq++;
  return {
    id: `loc-${seq}`,
    name: `Lot ${seq}`,
    source_name: 'spothero',
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

// --- deriveLocality: clean hits ---------------------------------------------

test('deriveLocality: "Brickell" keyword -> Brickell', () => {
  assert.equal(deriveLocality('1234 Brickell Ave, Miami, FL'), 'Brickell');
});

test('deriveLocality: "CBD" keyword -> Downtown / CBD', () => {
  assert.equal(deriveLocality('500 Biscayne Blvd, CBD, Miami'), 'Downtown / Central Business District');
});

test('deriveLocality: "Downtown" keyword -> Downtown / CBD', () => {
  assert.equal(deriveLocality('50 NE 1st St, Downtown Miami'), 'Downtown / Central Business District');
});

test('deriveLocality: "Wynwood" keyword -> Wynwood / Design District', () => {
  assert.equal(deriveLocality('250 NW 24th St, Wynwood, Miami'), 'Wynwood / Design District');
});

test('deriveLocality: "Design District" keyword -> Wynwood / Design District', () => {
  assert.equal(deriveLocality('140 NE 39th St, Design District'), 'Wynwood / Design District');
});

test('deriveLocality: "South Beach" keyword -> South Beach', () => {
  assert.equal(deriveLocality('800 Ocean Dr, South Beach, Miami Beach'), 'South Beach');
});

test('deriveLocality: "Key Biscayne" keyword -> Key Biscayne', () => {
  assert.equal(deriveLocality('88 W McIntyre St, Key Biscayne, FL'), 'Key Biscayne');
});

test('deriveLocality: "Miami Springs" keyword -> Airport / Miami Springs', () => {
  assert.equal(deriveLocality('120 Curtiss Pkwy, Miami Springs, FL'), 'Airport / Miami Springs');
});

test('deriveLocality: "Coconut Grove" keyword -> Coconut Grove', () => {
  assert.equal(deriveLocality('3390 Mary St, Coconut Grove, Miami'), 'Coconut Grove');
});

// --- deriveLocality: miss / no address --------------------------------------

test('deriveLocality: no matching keywords -> null', () => {
  assert.equal(deriveLocality('1 Random Rd, Anytown, FL'), null);
});

test('deriveLocality: undefined address -> null', () => {
  assert.equal(deriveLocality(undefined), null);
});

// --- deriveLocality: genuine ambiguity --------------------------------------

test('deriveLocality: address mentioning two different localities\' keywords -> null (ambiguous)', () => {
  assert.equal(deriveLocality('Wynwood to Brickell shuttle stop, Miami'), null);
});

test('deriveLocality: an address whose keywords all resolve to the SAME locality is not ambiguous', () => {
  // "Wynwood" and "Design District" both map to the same locality (#4) —
  // matching both keywords must not be treated as cross-locality ambiguity.
  assert.equal(deriveLocality('Wynwood / Design District warehouse, Miami'), 'Wynwood / Design District');
});

test('deriveLocality: a keyword nested inside another locality\'s keyword resolves to the more specific one', () => {
  // "North Miami" is a literal substring of "North Miami Beach" — that's
  // specificity, not two localities both being mentioned.
  assert.equal(deriveLocality('1500 NE 135th St, North Miami Beach, FL'), 'North Miami Beach');
  assert.equal(deriveLocality('12000 NE 16th Ave, North Miami, FL'), 'North Miami');
});

// --- deriveLocality: real lat/lng beats address text ------------------------

test('deriveLocality: lat/lng near a locality center resolves to that locality, even with no address', () => {
  const c = LOCALITY_CENTERS['Edgewater / Midtown'];
  assert.equal(deriveLocality(undefined, c.lat, c.lng), 'Edgewater / Midtown');
});

test('deriveLocality: lat/lng near a locality center wins even when the address text says something else entirely', () => {
  // The real bug this covers: "3401 N Miami Ave" never contains "midtown" or
  // "edgewater", so keyword matching alone would return null here — the
  // coordinates should carry it instead.
  const c = LOCALITY_CENTERS['Edgewater / Midtown'];
  assert.equal(deriveLocality('3401 N Miami Ave, Miami, FL 33127', c.lat, c.lng), 'Edgewater / Midtown');
});

test('deriveLocality: lat/lng far outside every locality falls back to address keyword matching', () => {
  // Orlando, nowhere near any Miami-Dade locality center.
  assert.equal(deriveLocality('123 Brickell Ave, Miami, FL', 28.5383, -81.3792), 'Brickell');
});

test('deriveLocality: lat/lng far outside every locality AND no usable address -> null', () => {
  assert.equal(deriveLocality('1 Random Rd, Anytown, FL', 28.5383, -81.3792), null);
});

// --- isEnriched --------------------------------------------------------------

test('isEnriched: fewer than 5 non-empty fields -> false', () => {
  const loc = makeLocation({ price_text: '$10/day', hours_text: '9-5' });
  assert.equal(isEnriched(loc), false);
});

test('isEnriched: exactly 5 non-empty fields -> true', () => {
  const loc = makeLocation({
    price_text: '$10/day',
    hours_text: '9-5',
    capacity_text: '400 spaces',
    is_fenced: true,
    is_lit: false,
  });
  assert.equal(isEnriched(loc), true);
});

test('isEnriched: tri-state null counts as filled for access247/fenced/lit', () => {
  const loc = makeLocation({
    price_text: '$10/day',
    hours_text: '9-5',
    is_24_7: null,
    is_fenced: null,
    is_lit: null,
  });
  assert.equal(isEnriched(loc), true);
});

test('isEnriched: surfaceType/gateType null (untouched default) does NOT count as filled', () => {
  const loc = makeLocation({
    price_text: '$10/day',
    hours_text: '9-5',
    capacity_text: '400 spaces',
    surface_type: null,
    gate_type: null,
  });
  assert.equal(isEnriched(loc), false); // only 3 real fields filled
});

// --- localityStats -----------------------------------------------------------

test('localityStats: returns every canonical locality, including zero-lot ones', () => {
  const stats = localityStats([]);
  assert.equal(stats.length, LOCALITIES.length);
  assert.deepEqual(stats.map((s) => s.locality), LOCALITIES);
  assert.ok(stats.every((s) => s.lotCount === 0));
});

test('localityStats: lotCount/enrichedCount/savedCount per locality', () => {
  const locations = [
    makeLocation({ locality: 'Brickell', status: 'saved' }),
    makeLocation({
      locality: 'Brickell',
      price_text: '$10',
      hours_text: '9-5',
      capacity_text: '400',
      is_fenced: true,
      is_lit: true,
    }),
    makeLocation({ locality: 'South Beach' }),
  ];
  const stats = localityStats(locations);
  const brickell = stats.find((s) => s.locality === 'Brickell')!;
  const southBeach = stats.find((s) => s.locality === 'South Beach')!;
  const keyBiscayne = stats.find((s) => s.locality === 'Key Biscayne')!;

  assert.equal(brickell.lotCount, 2);
  assert.equal(brickell.savedCount, 1);
  assert.equal(brickell.enrichedCount, 1);
  assert.equal(southBeach.lotCount, 1);
  assert.equal(keyBiscayne.lotCount, 0);
});

test('localityStats: needsHunt trips when lotCount < 20% of the best-covered locality (max-based, not median)', () => {
  // Downtown @ 100 (the max) -> threshold = 20. Key Biscayne @ 1 trips;
  // Brickell @ 25 doesn't; every untouched (0-lot) locality also trips —
  // this must hold even with dozens of localities sitting at zero, which is
  // exactly the case max-based (not median-based) thresholding is for: with
  // most of the 26 localities at 0, the median would collapse to 0 and
  // nothing would ever trip needsHunt.
  const locations = [
    ...Array.from({ length: 100 }, () => makeLocation({ locality: 'Downtown / Central Business District' })),
    ...Array.from({ length: 25 }, () => makeLocation({ locality: 'Brickell' })),
    makeLocation({ locality: 'Key Biscayne' }),
  ];
  const stats = localityStats(locations);
  const downtown = stats.find((s) => s.locality === 'Downtown / Central Business District')!;
  const brickell = stats.find((s) => s.locality === 'Brickell')!;
  const keyBiscayne = stats.find((s) => s.locality === 'Key Biscayne')!;
  const untouched = stats.find((s) => s.locality === 'Doral')!; // 0 lots, also trips
  assert.equal(downtown.needsHunt, false);
  assert.equal(brickell.needsHunt, false);
  assert.equal(keyBiscayne.needsHunt, true);
  assert.equal(untouched.needsHunt, true);
});

test('localityStats: locations with no locality (null-match) are not attributed to any row', () => {
  const locations = [makeLocation({ locality: undefined })];
  const stats = localityStats(locations);
  assert.ok(stats.every((s) => s.lotCount === 0));
});

// --- countUnassignedLocality ---------------------------------------------------

test('countUnassignedLocality: counts records missing locality', () => {
  const locations = [
    makeLocation({ locality: 'Brickell' }),
    makeLocation({ locality: undefined }),
    makeLocation({ locality: undefined }),
  ];
  assert.equal(countUnassignedLocality(locations), 2);
});

console.log('\nall locality tests passed');
