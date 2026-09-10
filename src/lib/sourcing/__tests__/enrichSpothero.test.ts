// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds fixtures shaped exactly like the real facility-detail
// __NEXT_DATA__ payload (captured from spothero.com/facility/92951/... and
// spothero.com/facility/100130/... on 2026-08-23) through the pure
// parse/map functions in spotheroDetailParse.ts. Never imports
// enrichSpothero.ts or store.ts ('server-only' would throw under plain
// node outside a react-server condition) — same split as spothero.test.ts.
import assert from 'node:assert/strict';
import {
  extractFacilityQueryData,
  mapFacilityDetailToInput,
  selectUnenrichedSpotHero,
} from '../spotheroDetailParse.ts';
import type { SpotHeroFacilityDetail } from '../spotheroDetailParse.ts';
import { buildUpsertDoc } from '../types.ts';
import type { SourcedLocationInput, SourcedParkingLocation } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// Real shape, trimmed to the fields we read. Modeled on the actual
// facility/92951 (self-park garage, 74in clearance, height-restriction
// text) response.
function facilityQueryHtml(data: SpotHeroFacilityDetail): string {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: ['facility', '92951'], state: { data } },
            { queryKey: ['facilityNearbySpots', '92951'], state: { data: {} } },
          ],
        },
      },
    },
  };
  return `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></head><body></body></html>`;
}

const GARAGE_DETAIL: SpotHeroFacilityDetail = {
  title: '100 SE 2nd St. - James L. Knight Center Garage',
  restrictions: ["Height Restriction: 6' 2\"", 'Please note, lot does not have in/out privileges.'],
  amenities: [
    { type: 'self-park', display_name: 'Self Park' },
    { type: 'covered-parking', display_name: 'Garage - Covered' },
  ],
  hoursOfOperation: { periods: [], text: ['This facility is open 24/7.'], always_open: true },
  firstRateInfo: { cost: { value: 1500, currencyCode: 'USD' }, duration: '4 hours' },
  fullFacilityData: { common: { clearance_inches: 74, facility_type: 'garage' } },
};

const VALET_DETAIL: SpotHeroFacilityDetail = {
  title: '255 Biscayne Blvd Way - JW Marriott Marquis Valet',
  restrictions: [],
  amenities: [{ type: 'valet', display_name: 'Valet' }],
  hoursOfOperation: {
    periods: [{ first_day: 'Mon', last_day: 'Sun', start_time: '06:00:00', end_time: '03:00:00' }],
    text: [],
    always_open: false,
  },
  firstRateInfo: { cost: { value: 3500, currencyCode: 'USD' }, duration: '16 hours' },
  fullFacilityData: { common: { clearance_inches: null, facility_type: 'valet_stand' } },
};

test('extractFacilityQueryData: pulls the "facility" react-query cache entry out of __NEXT_DATA__', () => {
  const html = facilityQueryHtml(GARAGE_DETAIL);
  const jsonStart = html.indexOf('{"props"');
  const jsonEnd = html.indexOf('</script>', jsonStart);
  const nextData = JSON.parse(html.slice(jsonStart, jsonEnd));
  const detail = extractFacilityQueryData(nextData);
  assert.ok(detail);
  assert.equal(detail!.title, GARAGE_DETAIL.title);
});

test('extractFacilityQueryData: returns null when no facility query is present', () => {
  const detail = extractFacilityQueryData({ props: { pageProps: { dehydratedState: { queries: [] } } } });
  assert.equal(detail, null);
});

test('mapFacilityDetailToInput: clearance extracted verbatim from the height-restriction line', () => {
  const input = mapFacilityDetailToInput(GARAGE_DETAIL, 'https://spothero.com/facility/92951/100-se-2nd-st-parking', '92951');
  assert.equal(input.clearanceText, "Height Restriction: 6' 2\"");
  assert.equal(input.fieldProvenance!.clearance_text, 'self-reported');
});

test('mapFacilityDetailToInput: no clearance data (valet stand, null clearance_inches, no height text) -> undefined', () => {
  const input = mapFacilityDetailToInput(VALET_DETAIL, 'https://spothero.com/facility/100130/1109-brickell-ave-2-parking', '100130');
  assert.equal(input.clearanceText, undefined);
  assert.equal(input.fieldProvenance!.clearance_text, undefined);
});

test('mapFacilityDetailToInput: falls back to formatted clearance_inches when no height-restriction text exists', () => {
  const detail: SpotHeroFacilityDetail = {
    ...GARAGE_DETAIL,
    restrictions: ['Please note, lot does not have in/out privileges.'], // no height line
  };
  const input = mapFacilityDetailToInput(detail, 'https://spothero.com/facility/92951/100-se-2nd-st-parking', '92951');
  assert.equal(input.clearanceText, `6'2" clearance`);
});

test('mapFacilityDetailToInput: firstRateInfo mapped to a priceText-style summary, same $X.XX (Nhr) shape as the city tier', () => {
  const input = mapFacilityDetailToInput(GARAGE_DETAIL, 'https://spothero.com/facility/92951/100-se-2nd-st-parking', '92951');
  assert.equal(input.priceText, '$15.00 (4hr)');
});

test('mapFacilityDetailToInput: hoursText — always_open takes priority, normalized to "Open 24/7"', () => {
  const input = mapFacilityDetailToInput(GARAGE_DETAIL, 'https://spothero.com/facility/92951/100-se-2nd-st-parking', '92951');
  assert.equal(input.hoursText, 'Open 24/7');
});

test('mapFacilityDetailToInput: hoursText — periods fallback when not always-open and no text[]', () => {
  const input = mapFacilityDetailToInput(VALET_DETAIL, 'https://spothero.com/facility/100130/1109-brickell-ave-2-parking', '100130');
  assert.equal(input.hoursText, 'Mon-Sun 06:00-03:00');
});

test('mapFacilityDetailToInput: source/sourceListingId pass through unchanged, capturedBy scraped', () => {
  const input = mapFacilityDetailToInput(GARAGE_DETAIL, 'https://spothero.com/facility/92951/100-se-2nd-st-parking', '92951');
  assert.equal(input.source, 'spothero');
  assert.equal(input.sourceListingId, '92951');
  assert.equal(input.capturedBy, 'scraped');
});

test('mapFacilityDetailToInput: evidenceDetail carries a trimmed snapshot, not the full payload', () => {
  const input = mapFacilityDetailToInput(GARAGE_DETAIL, 'https://spothero.com/facility/92951/100-se-2nd-st-parking', '92951');
  const detail = input.evidenceDetail as Record<string, unknown>;
  assert.equal(detail.clearanceInches, 74);
  assert.equal(detail.facilityType, 'garage');
  assert.deepEqual(detail.amenities, ['self-park', 'covered-parking']);
  assert.ok(!('title' in detail), 'title is not duplicated into the evidence snapshot');
});

// --- the critical one: enrichment must never blindly overwrite an
// already-populated field, and must route through the SAME buildUpsertDoc
// merge logic every other ingest uses — not a special-cased force-overwrite.

test('CRITICAL: empty-field-only fill respected — existing priceText/hoursText survive, conflict logged', () => {
  const cityTierInput: SourcedLocationInput = {
    name: '100 SE 2nd St. - James L. Knight Center Garage',
    address: '100 Southeast 2nd Street, Miami, FL 33131',
    lat: 25.772085,
    lng: -80.191299,
    source: 'spothero',
    sourceUrl: 'https://spothero.com/facility/92951/100-se-2nd-st-parking',
    sourceListingId: '92951',
    priceText: '$15.00 (4hr)', // already populated by the city tier
    hoursText: 'Mon-Fri 6am-11pm', // already populated, deliberately DIFFERENT from the facility page's 24/7
    capturedBy: 'scraped',
    fieldProvenance: { price_text: 'self-reported', hours_text: 'self-reported' },
    rawInput: { spotId: '92951' },
  };
  const existing = buildUpsertDoc(null, cityTierInput, '2026-08-23T00:00:00.000Z');
  assert.equal(existing.clearance_text, undefined, 'sanity: city tier never set clearanceText');

  const enrichInput = mapFacilityDetailToInput(GARAGE_DETAIL, cityTierInput.sourceUrl, '92951');
  const merged = buildUpsertDoc(existing, enrichInput, '2026-08-23T01:00:00.000Z');

  // priceText matches on both sides here -> no conflict, existing value kept as-is.
  assert.equal(merged.price_text, '$15.00 (4hr)');
  // hoursText conflicts (existing 'Mon-Fri 6am-11pm' vs facility page '24/7 text')
  // -> existing wins, conflict logged, NOT force-overwritten.
  assert.equal(merged.hours_text, 'Mon-Fri 6am-11pm', 'existing hoursText must survive - no special-cased overwrite');
  assert.ok(merged.notes?.includes('conflict:hours_text:'), `expected a logged hoursText conflict, notes was: ${merged.notes}`);
  // clearanceText was empty on existing -> genuinely new field, gets filled.
  assert.equal(merged.clearance_text, "Height Restriction: 6' 2\"");
  assert.equal(merged.field_sources.clearance_text, 'self-reported');
});

test('empty-field-only fill: when the existing field really is empty, enrichment fills it (not just clearanceText)', () => {
  const cityTierInput: SourcedLocationInput = {
    name: '100 SE 2nd St. - James L. Knight Center Garage',
    source: 'spothero',
    sourceUrl: 'https://spothero.com/facility/92951/100-se-2nd-st-parking',
    sourceListingId: '92951',
    capturedBy: 'scraped',
    rawInput: { spotId: '92951' },
    // no priceText / hoursText this time
  };
  const existing = buildUpsertDoc(null, cityTierInput, '2026-08-23T00:00:00.000Z');
  const enrichInput = mapFacilityDetailToInput(GARAGE_DETAIL, cityTierInput.sourceUrl, '92951');
  const merged = buildUpsertDoc(existing, enrichInput, '2026-08-23T01:00:00.000Z');

  assert.equal(merged.price_text, '$15.00 (4hr)');
  assert.equal(merged.hours_text, 'Open 24/7');
  assert.equal(merged.field_sources.price_text, 'self-reported');
});

test('evidence: re-upserting under the same source updates that entry in place (detail attached), not appended', () => {
  const cityTierInput: SourcedLocationInput = {
    name: 'X', source: 'spothero', sourceUrl: 'https://spothero.com/facility/92951/100-se-2nd-st-parking',
    sourceListingId: '92951', capturedBy: 'scraped', rawInput: {},
  };
  const existing = buildUpsertDoc(null, cityTierInput, '2026-08-23T00:00:00.000Z');
  assert.equal(existing.evidence.length, 1);
  assert.equal(existing.evidence[0].detail, undefined);

  const enrichInput = mapFacilityDetailToInput(GARAGE_DETAIL, cityTierInput.sourceUrl, '92951');
  const merged = buildUpsertDoc(existing, enrichInput, '2026-08-23T01:00:00.000Z');

  assert.equal(merged.evidence.length, 1, 'still one spothero evidence entry, not two');
  assert.equal(merged.evidence[0].seen_at, '2026-08-23T01:00:00.000Z', 'seenAt refreshed');
  assert.ok(merged.evidence[0].detail, 'evidence entry now carries the facility-page detail snapshot');
});

// --- selection/skip logic ---

function fakeDoc(id: string, source: string, enrichedAt?: string): SourcedParkingLocation {
  return {
    id, name: id, source_name: source, source_url: `https://spothero.com/facility/${id}/x-parking`, source_listing_id: id,
    evidence: [], field_sources: {}, captured_by: 'scraped', status: 'draft', raw_input: null,
    created_at: '2026-08-23T00:00:00.000Z', updated_at: '2026-08-23T00:00:00.000Z', enriched_at: enrichedAt,
  };
}

test('selectUnenrichedSpotHero: already-enriched (truthy enrichedAt) records are skipped', () => {
  const records = [
    fakeDoc('1', 'spothero', '2026-08-22T00:00:00.000Z'), // already enriched -> skip
    fakeDoc('2', 'spothero'), // not enriched -> candidate
    fakeDoc('3', 'spothero'), // not enriched -> candidate
    fakeDoc('4', 'parkopedia'), // wrong source -> excluded regardless
  ];
  const selected = selectUnenrichedSpotHero(records, 20);
  assert.deepEqual(selected.map((r) => r.id), ['2', '3']);
});

test('selectUnenrichedSpotHero: respects the limit cap', () => {
  const records = [fakeDoc('1', 'spothero'), fakeDoc('2', 'spothero'), fakeDoc('3', 'spothero')];
  const selected = selectUnenrichedSpotHero(records, 2);
  assert.equal(selected.length, 2);
});

console.log('\nall enrichSpothero tests passed');
