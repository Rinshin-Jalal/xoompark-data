// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds fixtures shaped exactly like the real FEMA NFHL
// response payloads (captured against Esri's synced NFHL mirror on
// 2026-08-23, since hazards.fema.gov itself was unreachable from the
// sandbox this was built in — see geoContext.ts's header comment for the
// full writeup) through the pure functions in geoContextParse.ts. Never
// imports geoContext.ts or store.ts ('server-only' would throw under plain
// node outside a react-server condition) — same split as
// enrichSpothero.test.ts.
import assert from 'node:assert/strict';
import {
  flattenResidentialVertices,
  haversineMeters,
  isResidentialAdjacent,
  parseFemaFloodResponse,
  selectGeoContextCandidates,
} from '../geoContextParse.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// --- FEMA response parsing: real fixtures, not fabricated ---
//
// HIT: queried downtown Miami (25.7700, -80.1950) against
// services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/
// USA_Flood_Hazard_Areas_view/FeatureServer/0/query (outFields=*).
const FEMA_HIT_RESPONSE = {
  objectIdFieldName: 'OBJECTID',
  uniqueIdField: { name: 'OBJECTID', isSystemMaintained: true },
  globalIdFieldName: '',
  geometryType: 'esriGeometryPolygon',
  spatialReference: { wkid: 102100, latestWkid: 3857 },
  features: [
    {
      attributes: {
        OBJECTID: 963641,
        DFIRM_ID: '12086C',
        VERSION_ID: '1.1.1.0',
        FLD_AR_ID: '12086C_2898',
        STUDY_TYP: 'NP',
        FLD_ZONE: 'AE',
        ZONE_SUBTY: null,
        SFHA_TF: 'T',
        STATIC_BFE: 9,
        V_DATUM: 'NGVD29',
        SOURCE_CIT: '12086C_FIS1',
        esri_symbology: '1% Annual Chance Flood Hazard',
      },
    },
  ],
};

// MISS: queried rural Kansas (38.5, -98.5) and Coral Gables (25.7215,
// -80.2781) against the same service, outFields=FLD_ZONE,ZONE_SUBTY,
// SFHA_TF,STATIC_BFE — both returned this identical empty-features shape.
const FEMA_MISS_RESPONSE = {
  objectIdFieldName: 'OBJECTID',
  uniqueIdField: { name: 'OBJECTID', isSystemMaintained: true },
  globalIdFieldName: '',
  features: [],
};

test('parseFemaFloodResponse: real HIT payload -> zone letter + floodHazardArea true', () => {
  const result = parseFemaFloodResponse(FEMA_HIT_RESPONSE);
  assert.equal(result.floodZone, 'AE');
  assert.equal(result.floodHazardArea, true);
});

test('parseFemaFloodResponse: real MISS payload (empty features) -> null zone, floodHazardArea false', () => {
  const result = parseFemaFloodResponse(FEMA_MISS_RESPONSE);
  assert.equal(result.floodZone, null);
  assert.equal(result.floodHazardArea, false);
});

test('parseFemaFloodResponse: SFHA_TF "F" (non-SFHA zone present, e.g. shaded X) -> floodHazardArea false but zone still reported', () => {
  const result = parseFemaFloodResponse({
    features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' } }],
  });
  assert.equal(result.floodZone, 'X');
  assert.equal(result.floodHazardArea, false);
});

test('parseFemaFloodResponse: malformed/missing features key -> treated as a clean miss, never throws', () => {
  assert.deepEqual(parseFemaFloodResponse({}), { floodZone: null, floodHazardArea: false });
  assert.deepEqual(parseFemaFloodResponse(null), { floodZone: null, floodHazardArea: false });
});

// --- residential adjacency (pure distance calc, fixture coordinates) ---

test('haversineMeters: known distance sanity check (~0.5 degrees latitude at the equator ~= 55.5km)', () => {
  const d = haversineMeters(0, 0, 0.5, 0);
  assert.ok(d > 55000 && d < 56000, `expected ~55.5km, got ${d}m`);
});

test('isResidentialAdjacent: vertex within threshold -> true', () => {
  const vertices = [{ lat: 25.7617, lng: -80.1918 }];
  // ~0.001 degrees lat is roughly 111m — inside the default 150m threshold.
  const nearby = { lat: 25.7627, lng: -80.1918 };
  assert.equal(isResidentialAdjacent(nearby.lat, nearby.lng, vertices), true);
});

test('isResidentialAdjacent: nearest vertex well outside threshold -> false', () => {
  const vertices = [{ lat: 25.7617, lng: -80.1918 }];
  const far = { lat: 25.9, lng: -80.1918 }; // ~15km away
  assert.equal(isResidentialAdjacent(far.lat, far.lng, vertices), false);
});

test('isResidentialAdjacent: no residential vertices at all -> false', () => {
  assert.equal(isResidentialAdjacent(25.7617, -80.1918, []), false);
});

test('isResidentialAdjacent: custom threshold respected', () => {
  const vertices = [{ lat: 25.7617, lng: -80.1918 }];
  const point = { lat: 25.7627, lng: -80.1918 }; // ~111m away
  assert.equal(isResidentialAdjacent(point.lat, point.lng, vertices, 50), false);
  assert.equal(isResidentialAdjacent(point.lat, point.lng, vertices, 150), true);
});

test('flattenResidentialVertices: pulls every geometry point out of every element', () => {
  const elements = [
    { geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
    { geometry: [{ lat: 5, lon: 6 }] },
    {}, // no geometry -> contributes nothing, doesn't throw
  ];
  const vertices = flattenResidentialVertices(elements);
  assert.deepEqual(vertices, [
    { lat: 1, lng: 2 },
    { lat: 3, lng: 4 },
    { lat: 5, lng: 6 },
  ]);
});

// --- candidate selection: missing-geoContext-first, no-coords skip logic ---

interface FakeRecord {
  id: string;
  lat?: number;
  lng?: number;
  geoContext?: unknown;
}

test('selectGeoContextCandidates: already-checked (has geoContext) records excluded entirely', () => {
  const records: FakeRecord[] = [
    { id: '1', lat: 25.7, lng: -80.2, geoContext: { checkedAt: 'x' } },
    { id: '2', lat: 25.7, lng: -80.2 },
  ];
  const { candidates } = selectGeoContextCandidates(records, 10);
  assert.deepEqual(candidates.map((r) => r.id), ['2']);
});

test('selectGeoContextCandidates: missing lat/lng -> skipped, counted, never a candidate, never throws', () => {
  const records: FakeRecord[] = [
    { id: '1' }, // no coords
    { id: '2', lat: 25.7 }, // lng missing
    { id: '3', lat: 25.7, lng: -80.2 }, // valid
  ];
  const { candidates, skippedNoCoords } = selectGeoContextCandidates(records, 10);
  assert.deepEqual(candidates.map((r) => r.id), ['3']);
  assert.equal(skippedNoCoords, 2);
});

test('selectGeoContextCandidates: respects the limit cap', () => {
  const records: FakeRecord[] = [
    { id: '1', lat: 1, lng: 1 },
    { id: '2', lat: 1, lng: 1 },
    { id: '3', lat: 1, lng: 1 },
  ];
  const { candidates } = selectGeoContextCandidates(records, 2);
  assert.equal(candidates.length, 2);
});

console.log('\nall geoContext tests passed');
