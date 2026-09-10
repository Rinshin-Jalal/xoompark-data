// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same Firestore-free style as the sourcing tests — only imports sites.ts,
// which only imports hardFilters.ts + types.ts.
import assert from 'node:assert/strict';
import { filterFleetSites, toFleetSiteSummary, toFleetSiteDetail, parseFleetQuery } from '../sites.ts';
import { detectOperator } from '../../sourcing/operators.ts';
import type { SourcedParkingLocation } from '../../sourcing/types.ts';

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
    id: `t${seq}`,
    name: `Lot ${seq}`,
    // Downtown Miami — inside the Waymo ODD, so the hard ODD filter keeps it.
    lat: 25.7617,
    lng: -80.1917,
    source_name: 'test',
    source_url: 'https://example.com',
    evidence: [],
    field_sources: {},
    captured_by: 'admin',
    status: 'saved',
    raw_input: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as SourcedParkingLocation;
}

// --- ODD hard constraint -----------------------------------------------------

test('sites outside the Waymo ODD are always dropped', () => {
  const inOdd = makeLocation(); // downtown Miami
  const outsideOdd = makeLocation({ lat: 40.7128, lng: -74.006 }); // NYC — no Waymo ODD
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  const out = filterFleetSites([inOdd, outsideOdd, noCoords], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].id, inOdd.id);
});

// --- wide-net rule ------------------------------------------------------------

test('no query returns all sites including unknown-data ones', () => {
  const sites = [makeLocation(), makeLocation({ is_fenced: undefined, stall_count: undefined })];
  assert.equal(filterFleetSites(sites, {}).length, 2);
});

test('is_fenced=true excludes unknowns but bare query keeps them', () => {
  const unknown = makeLocation({ is_fenced: undefined });
  const is_fenced = makeLocation({ is_fenced: true });
  assert.equal(filterFleetSites([unknown, is_fenced], { is_fenced: true }).length, 1);
  assert.equal(filterFleetSites([unknown, is_fenced], {}).length, 2);
});

test('is_fenced=false requires a confirmed fail, not unknown', () => {
  const unknown = makeLocation({ is_fenced: undefined });
  const unfenced = makeLocation({ is_fenced: false });
  const out = filterFleetSites([unknown, unfenced], { is_fenced: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].is_fenced, false);
});

test('null (checked, could not tell) behaves like unknown for filters', () => {
  const nullLit = makeLocation({ is_lit: null });
  assert.equal(filterFleetSites([nullLit], {}).length, 1); // wide net keeps it
  assert.equal(filterFleetSites([nullLit], { is_lit: true }).length, 0); // explicit ask drops it
  assert.equal(filterFleetSites([nullLit], { is_lit: false }).length, 0);
});

test('minStalls drops unknown stall counts and below-minimum sites', () => {
  const unknown = makeLocation({ stall_count: undefined });
  const nullStalls = makeLocation({ stall_count: null });
  const small = makeLocation({ stall_count: 30 });
  const big = makeLocation({ stall_count: 80 });
  const out = filterFleetSites([unknown, nullStalls, small, big], { minStalls: 50 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, big.id);
});

test('minStalls=50 boundary: exactly 50 passes', () => {
  assert.equal(filterFleetSites([makeLocation({ stall_count: 50 })], { minStalls: 50 }).length, 1);
});

test('surface_type and gate_type match exactly, unknown excluded', () => {
  const surface = makeLocation({ surface_type: 'surface' });
  const structured = makeLocation({ surface_type: 'structured' });
  const unknown = makeLocation({ surface_type: null });
  assert.equal(filterFleetSites([surface, structured, unknown], { surface_type: 'surface' }).length, 1);
  const lpr = makeLocation({ gate_type: 'lpr' });
  const manual = makeLocation({ gate_type: 'manual' });
  assert.equal(filterFleetSites([lpr, manual], { gate_type: 'lpr' })[0].id, lpr.id);
});

test('all constraints compose (AND semantics)', () => {
  const match = makeLocation({ is_fenced: true, is_lit: true, is_24_7: true, stall_count: 100, surface_type: 'surface', gate_type: 'lpr' });
  const nearMiss = makeLocation({ is_fenced: true, is_lit: true, is_24_7: true, stall_count: 100, surface_type: 'surface', gate_type: 'manual' });
  const out = filterFleetSites([match, nearMiss], {
    is_fenced: true, is_lit: true, is_24_7: true, minStalls: 50, surface_type: 'surface', gate_type: 'lpr',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, match.id);
});

// --- geo ----------------------------------------------------------------------

test('geo filter drops sites without coords and outside radius', () => {
  // ~1.1km apart (Miami coords, both in-ODD)
  const near = makeLocation({ lat: 25.7617, lng: -80.1917 });
  const far = makeLocation({ lat: 25.7717, lng: -80.1917 });
  const noCoords = makeLocation({ lat: undefined, lng: undefined });
  const out = filterFleetSites([near, far, noCoords], { center: { lat: 25.7617, lng: -80.1917 }, radiusM: 500 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, near.id);
});

test('geo radius default is 5000m when center given without radiusM', () => {
  const at4km = makeLocation({ lat: 25.7617 + 0.036, lng: -80.1917 }); // ~4km north
  const at6km = makeLocation({ lat: 25.7617 + 0.054, lng: -80.1917 }); // ~6km north
  const out = filterFleetSites([at4km, at6km], { center: { lat: 25.7617, lng: -80.1917 } });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, at4km.id);
});

test('haversine: zero distance to self, symmetric, antimeridian-safe', () => {
  assert.equal(haversine(25.7617, -80.1917, 25.7617, -80.1917), 0);
  const ab = haversine(25.76, -80.19, 25.77, -80.20);
  const ba = haversine(25.77, -80.20, 25.76, -80.19);
  assert.ok(Math.abs(ab - ba) < 1e-9);
  // 1 degree of longitude at the equator ~111km, across the antimeridian
  const d = haversine(0, 179.5, 0, -179.5);
  assert.ok(d > 100_000 && d < 125_000, `antimeridian distance was ${d}`);
});

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // re-imported below; wrapper for readability
  return hav(lat1, lng1, lat2, lng2);
}
import { haversineMeters as hav } from '../sites.ts';

// --- limit --------------------------------------------------------------------

test('limit slices results', () => {
  const sites = [makeLocation(), makeLocation(), makeLocation()];
  assert.equal(filterFleetSites(sites, { limit: 2 }).length, 2);
  assert.equal(filterFleetSites(sites, { limit: 0 }).length, 0);
});

// --- summary projection -------------------------------------------------------

test('summary carries all 9 hard-filter tri-states and never invents a fail', () => {
  const loc = makeLocation({ is_fenced: true, stall_count: 120 });
  const s = toFleetSiteSummary(loc);
  assert.equal(s.hardFilters.is_fenced, 'pass');
  assert.equal(s.hardFilters.fiftyPlusStalls, 'pass');
  assert.equal(s.hardFilters.cellCoverage, 'unknown');
  assert.equal(s.hardFilters.dedicatedStalls, 'unknown');
  assert.equal(Object.keys(s.hardFilters).length, 9);
});

test('summary reports confirmed hard fails (flood zone, residential adjacency)', () => {
  const loc = makeLocation({
    enrichment: { geo: { floodHazardArea: true, floodZone: 'AE', residentialAdjacent: true, checkedAt: '2026-01-01T00:00:00Z' } },
  });
  const s = toFleetSiteSummary(loc);
  assert.equal(s.hardFilters.aboveFloodPlain, 'fail');
  assert.equal(s.hardFilters.notResidentialAdjacent, 'fail');
});

test('summary normalizes undefined soft fields to null, keeps falsy values', () => {
  const s = toFleetSiteSummary(makeLocation({ stall_count: 0, surface_type: undefined, gate_type: undefined }));
  assert.equal(s.stall_count, 0); // 0 is a real value, not unknown
  assert.equal(s.surface_type, null);
  assert.equal(s.gate_type, null);
  assert.equal(s.is_24_7, null);
});

test('summary distanceM only present with a center', () => {
  const loc = makeLocation({ lat: 25.7617, lng: -80.1917 });
  assert.equal(toFleetSiteSummary(loc).distanceM, undefined);
  assert.equal(typeof toFleetSiteSummary(loc, { lat: 25.7617, lng: -80.1917 }).distanceM, 'number');
});

// --- query-string parsing (the route's param glue) ----------------------------

test('REGRESSION: bare query string constrains nothing except managed (null vs undefined)', () => {
  // The original bug: q.get() returns null for absent params, and null
  // slipped into FleetSiteQuery where undefined means "no constraint" —
  // a bare GET dropped every site with a known gate_type.
  const parsed = parseFleetQuery(new URLSearchParams(''));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const { query, status } = parsed.value;
  assert.equal(query.gate_type, undefined);
  assert.equal(query.surface_type, undefined);
  assert.equal(query.minStalls, undefined);
  assert.equal(query.radiusM, undefined);
  assert.equal(query.center, undefined);
  assert.equal(query.is_fenced, undefined);
  assert.equal(query.is_24_7, undefined);
  assert.equal(query.is_lit, undefined);
  assert.equal(query.limit, 200); // default
  assert.equal(query.managed, true); // the ONE default-on filter (commercial requirement)
  assert.equal(status, undefined);
  // And through the filter: a site with a known gate_type survives a bare query.
  // (operator_id set — the default managed:true filter keeps only identified lots.)
  const lpr = makeLocation({ gate_type: 'lpr', source_name: 'laz', name: 'Managed', operator_id: 'laz', operator_source: 'source' });
  assert.equal(filterFleetSites([lpr], query).length, 1);
});

test('parse: happy path with every param', () => {
  const sp = new URLSearchParams(
    'lat=25.76&lng=-80.19&radiusM=1000&minStalls=50&surface_type=surface&gate_type=lpr&is_24_7=true&is_fenced=false&is_lit=true&status=saved&limit=10',
  );
  const parsed = parseFleetQuery(sp);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const { query, status } = parsed.value;
  assert.deepEqual(query.center, { lat: 25.76, lng: -80.19 });
  assert.equal(query.radiusM, 1000);
  assert.equal(query.minStalls, 50);
  assert.equal(query.surface_type, 'surface');
  assert.equal(query.gate_type, 'lpr');
  assert.equal(query.is_24_7, true);
  assert.equal(query.is_fenced, false);
  assert.equal(query.is_lit, true);
  assert.equal(query.limit, 10);
  assert.equal(status, 'saved');
});

test('parse: empty-string params are rejected, not silently ignored', () => {
  for (const bad of ['lat=', 'lng=', 'radiusM=', 'minStalls=', 'limit=', 'surface_type=', 'gate_type=', 'status=', 'is_fenced=']) {
    const parsed = parseFleetQuery(new URLSearchParams(bad));
    assert.equal(parsed.ok, false, `expected error for ${bad}`);
  }
});

test('parse: rejects bad values for every param', () => {
  const cases = [
    'lat=abc', 'lng=abc', 'lat=91', 'lat=-91', 'lng=181', 'lng=-181',
    'lat=25.76', 'lng=-80.19', // lone lat / lone lng
    'radiusM=0', 'radiusM=-5', 'radiusM=50001', 'radiusM=abc',
    'minStalls=-1', 'minStalls=abc',
    'surface_type=gravel', 'gate_type=army', 'status=archived',
    'limit=0', 'limit=1001', 'limit=abc',
    'is_fenced=maybe', 'is_24_7=yes', 'is_lit=1',
  ];
  for (const c of cases) {
    const parsed = parseFleetQuery(new URLSearchParams(c));
    assert.equal(parsed.ok, false, `expected error for '${c}'`);
  }
});

test('parse: boundary values are accepted', () => {
  for (const good of ['lat=90&lng=180', 'lat=-90&lng=-180', 'radiusM=1', 'radiusM=50000', 'minStalls=0', 'limit=1', 'limit=1000']) {
    const parsed = parseFleetQuery(new URLSearchParams(good));
    assert.equal(parsed.ok, true, `expected ok for '${good}'`);
  }
});

test('parse: repeated params use the first value (URLSearchParams semantics)', () => {
  const parsed = parseFleetQuery(new URLSearchParams('limit=5&limit=9999'));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.query.limit, 5);
});

test('parse: rejects non-finite numerics (1e999 -> Infinity would empty results)', () => {
  for (const bad of ['minStalls=1e999', 'minStalls=Infinity', 'radiusM=1e999', 'limit=1e999', 'lat=1e999&lng=1e999']) {
    const parsed = parseFleetQuery(new URLSearchParams(bad));
    assert.equal(parsed.ok, false, `expected error for '${bad}'`);
  }
});

test('parse: whitespace-padded numerics are accepted (Number trims)', () => {
  const parsed = parseFleetQuery(new URLSearchParams('lat= 25.76 &lng= -80.19 &minStalls= 50 '));
  assert.equal(parsed.ok, true);
});

test('filter: negative limit clamps to zero instead of slicing from the end', () => {
  const sites = [makeLocation(), makeLocation(), makeLocation()];
  assert.equal(filterFleetSites(sites, { limit: -1 }).length, 0); // was 2 via slice(0,-1) — silent corruption
  assert.equal(filterFleetSites(sites, { limit: -1000 }).length, 0);
});

test('haversine: poles and max-distance sanity', () => {
  const pole = haversine(90, 0, -90, 0);
  assert.ok(pole > 19_900_000 && pole < 20_200_000, `half-circumference was ${pole}`); // ~20,015km
  assert.ok(haversine(90, 0, 90, 180) < 1); // same pole, any longitude
});

// --- fuzz: the parser must never throw, only return ok or error ----------

test('FUZZ: 5000 random garbage query strings never throw', () => {
  // Deterministic mulberry32 PRNG so a failure is reproducible.
  let seed = 0x1234abcd;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const keys = ['lat', 'lng', 'radiusM', 'minStalls', 'surface_type', 'gate_type', 'is_24_7', 'is_fenced', 'is_lit', 'status', 'limit', 'odd', 'garbage', '', '🎉'];
  const values = ['', ' ', 'abc', '0', '-1', '1e999', 'Infinity', 'NaN', '0x10', '1e2', '25.76', '-80.19', 'true', 'false', 'TRUE', 'surface', 'lpr', 'saved', '50000', '50001', '1000', '1001', '%20', 'a=b', '🎉', null, undefined, {}, []];
  for (let i = 0; i < 5000; i++) {
    const parts: string[] = [];
    const n = Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) {
      const k = keys[Math.floor(rand() * keys.length)];
      const v = values[Math.floor(rand() * values.length)];
      parts.push(`${k}=${v === null || v === undefined ? '' : String(v)}`);
    }
    const qs = parts.join('&');
    let r: ReturnType<typeof parseFleetQuery>;
    try {
      r = parseFleetQuery(new URLSearchParams(qs));
    } catch (err) {
      throw new Error(`parseFleetQuery threw on '${qs}': ${err}`);
    }
    assert.ok(r.ok === true || r.ok === false, `non-boolean ok for '${qs}'`);
  }
});

test('FUZZ: valid-ish inputs that parse ok never produce NaN in the query', () => {
  const samples = ['lat=25.76&lng=-80.19', 'minStalls=0', 'radiusM=50000', 'limit=1000', 'status=saved', 'is_fenced=true&is_lit=false'];
  for (const qs of samples) {
    const r = parseFleetQuery(new URLSearchParams(qs));
    assert.equal(r.ok, true, qs);
    if (!r.ok) continue;
    const q = r.value.query;
    for (const [k, v] of Object.entries(q)) {
      assert.ok(typeof v !== 'number' || !isNaN(v), `NaN leaked into ${k} for '${qs}'`);
    }
  }
});

// --- detail projection (field-leak protection) ------------------------------

test('detail never exposes internal workflow fields', () => {
  const loc = makeLocation({
    raw_input: { secret: 'scrape blob' },
    claimed_by: 'internal-bdr',
    added_by: 'internal-admin',
    field_sources: { is_fenced: 'verified' },
    notes: 'conflict:price_text:$5|$6',
    evidence: [{ source_name: 'spothero', url: 'https://example.com', seen_at: '2026-01-01T00:00:00Z' }],
  });
  const d = toFleetSiteDetail(loc);
  for (const banned of ['raw_input', 'claimed_by', 'added_by', 'field_sources', 'evidence']) {
    assert.ok(!(banned in d), `${banned} leaked into fleet detail`);
  }
});

test('detail keeps the fields fleets need (geoContext, hours, ingress)', () => {
  const loc = makeLocation({
    hours_text: '24/7',
    ingress_egress: 'separate one-way',
    enrichment: { geo: { floodHazardArea: false, residentialAdjacent: false, checkedAt: '2026-01-01T00:00:00Z' } },
  });
  const d = toFleetSiteDetail(loc);
  assert.equal(d.hours_text, '24/7');
  assert.equal(d.ingress_egress, 'separate one-way');
  assert.ok(d.enrichment?.geo && typeof d.enrichment.geo === 'object');
  assert.equal((d.hardFilters as Record<string, string>).is_fenced, 'unknown'); // summary projection present
});

test('detail: a hypothetical new internal field cannot leak by default', () => {
  // Simulate the schema growing an internal field the projection doesn't know.
  const grown = { ...makeLocation(), internalAuditTrail: 'do-not-ship' } as SourcedParkingLocation & { internalAuditTrail: string };
  const d = toFleetSiteDetail(grown);
  // Unknown fields DO pass through (wide-net philosophy: new fleet-relevant
  // data ships without code changes) — so this documents the trade-off: the
  // ban list is explicit, pass-through is deliberate. If a future internal
  // field must stay private, it must be added to INTERNAL_FIELDS.
  assert.equal(d.internalAuditTrail, 'do-not-ship');
});

// --- JSON-safety property ----------------------------------------------------

test('summary and detail are JSON-safe (no cycles; undefined keys drop, nothing appears)', () => {
  const loc = makeLocation({ enrichment: { geo: { floodHazardArea: true, floodZone: 'AE', checkedAt: '2026-01-01T00:00:00Z' } } });
  for (const [label, obj] of [['summary', toFleetSiteSummary(loc)], ['detail', toFleetSiteDetail(loc)]] as const) {
    const s = JSON.stringify(obj); // throws on cycles
    const back = JSON.parse(s);
    // One-directional: every key in the JSON existed on the original object.
    // (Originals may hold `undefined` values that JSON drops — standard and
    // exactly what NextResponse.json does — but no NEW key may appear.)
    for (const k of Object.keys(back)) assert.ok(k in obj, `${label}: key ${k} appeared from nowhere`);
  }
});

// --- fuzz: filter invariants --------------------------------------------------

test('FUZZ: filterFleetSites invariants hold under random locations x queries', () => {
  let seed = 0xdeadbeef;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  for (let iter = 0; iter < 500; iter++) {
    const locs: SourcedParkingLocation[] = Array.from({ length: 10 }, () => makeLocation({
      lat: pick([25.7617, 25.7717, 40.7128, undefined]),
      lng: pick([-80.1917, -80.2017, -74.006, undefined]),
      is_fenced: pick([true, false, null, undefined]),
      is_lit: pick([true, false, null, undefined]),
      is_24_7: pick([true, false, null, undefined]),
      stall_count: pick([0, 30, 50, 120, null, undefined]),
      surface_type: pick(['surface', 'structured', null, undefined]),
      gate_type: pick(['lpr', 'manual', 'gateless', null, undefined]),
    }));
    const query = {
      center: rand() < 0.5 ? { lat: 25.7617, lng: -80.1917 } : undefined,
      radiusM: pick([500, 5000, 50000]),
      minStalls: pick([0, 50, 100]),
      surface_type: pick<'surface' | 'structured' | undefined>(['surface', 'structured', undefined]),
      gate_type: pick<'lpr' | 'manual' | undefined>(['lpr', 'manual', undefined]),
      is_fenced: pick([true, false, undefined]),
      is_lit: pick([true, false, undefined]),
      is_24_7: pick([true, false, undefined]),
      limit: pick([1, 5, 100]),
    };
    const out = filterFleetSites(locs, query);

    // Invariant 1: subset of input.
    for (const o of out) assert.ok(locs.includes(o), 'result not from input');
    // Invariant 2: ODD-only, always.
    for (const o of out) assert.ok(o.lat === 25.7617 || o.lat === 25.7717, 'non-ODD site in results');
    // Invariant 3: limit respected.
    assert.ok(out.length <= (query.limit ?? Infinity), 'limit exceeded');
    // Invariant 4: every explicit constraint holds on every result.
    for (const o of out) {
      if (query.is_fenced !== undefined) assert.equal(o.is_fenced, query.is_fenced);
      if (query.is_lit !== undefined) assert.equal(o.is_lit, query.is_lit);
      if (query.is_24_7 !== undefined) assert.equal(o.is_24_7, query.is_24_7);
      if (query.minStalls !== undefined) assert.ok(typeof o.stall_count === 'number' && o.stall_count >= query.minStalls);
      if (query.surface_type !== undefined) assert.equal(o.surface_type, query.surface_type);
      if (query.gate_type !== undefined) assert.equal(o.gate_type, query.gate_type);
    }
  }
});

// --- operator management ------------------------------------------------------

// Fake registry mirroring the seeded operators collection (same patterns).
const REGISTRY = [
  { id: 'laz', name: 'LAZ Parking', slug: 'laz', name_patterns: ['\\blaz\\b'], source_mappings: ['laz'] },
  { id: 'interpark', name: 'InterPark', slug: 'interpark', name_patterns: ['inter\\s*park|\\bipark\\b'], source_mappings: ['ipark'] },
  { id: 'reimagined-pmc', name: 'Reimagined PMC', slug: 'reimagined-pmc', name_patterns: ['reimagined|\\bpmc\\b'], source_mappings: [] },
  { id: 'platinum', name: 'Platinum', slug: 'platinum', name_patterns: ['platinum\\s+park'], source_mappings: [] },
  { id: 'ace-parking', name: 'Ace Parking', slug: 'ace-parking', name_patterns: ['\\bace\\s+parking\\b'], source_mappings: [] },
  { id: 'paradise', name: 'Paradise', slug: 'paradise', name_patterns: ['paradise\\s+park'], source_mappings: [] },
];

test('detectOperator: source mapping (laz/ipark scrapers are managed by definition)', () => {
  assert.deepEqual(detectOperator({ source_name: 'laz', name: 'First Citizens Bank' }, REGISTRY), { operator_id: 'laz', operator_source: 'source' });
  assert.deepEqual(detectOperator({ source_name: 'ipark', name: 'Any Garage' }, REGISTRY), { operator_id: 'interpark', operator_source: 'source' });
});

test('detectOperator: name-based brand matching from any source', () => {
  assert.equal(detectOperator({ source_name: 'spothero', name: 'LAZ Parking First Citizens Bank' }, REGISTRY)?.operator_id, 'laz');
  assert.equal(detectOperator({ source_name: 'spothero', name: 'InterPark 100 Brickell' }, REGISTRY)?.operator_id, 'interpark');
  assert.equal(detectOperator({ source_name: 'manual', name: 'Ace Parking Downtown' }, REGISTRY)?.operator_id, 'ace-parking');
  assert.equal(detectOperator({ source_name: 'manual', name: 'Platinum Parking Midtown' }, REGISTRY)?.operator_id, 'platinum');
  assert.equal(detectOperator({ source_name: 'manual', name: 'Paradise Parking South Beach' }, REGISTRY)?.operator_id, 'paradise');
  assert.equal(detectOperator({ source_name: 'manual', name: 'Reimagined PMC Lot 4' }, REGISTRY)?.operator_id, 'reimagined-pmc');
});

test('detectOperator: LBT business license is the third signal', () => {
  assert.deepEqual(
    detectOperator({ enrichment: { business_license: { businessName: 'LAZ Parking' } } }, REGISTRY),
    { operator_id: 'laz', operator_source: 'lbt' },
  );
});

test('detectOperator: no false positives on lookalike names', () => {
  assert.equal(detectOperator({ source_name: 'spothero', name: 'Ace Hardware Plaza' }, REGISTRY), null);
  assert.equal(detectOperator({ source_name: 'spothero', name: 'Knight Center Garage' }, REGISTRY), null);
  assert.equal(detectOperator({ source_name: 'parkopedia', name: 'Brickell Bay Garage' }, REGISTRY), null);
  assert.equal(detectOperator({ source_name: 'manual', name: 'Platinum Realty Garage' }, REGISTRY), null); // no "park"
  assert.equal(detectOperator({ source_name: 'manual', name: 'Paradise Casino Valet' }, REGISTRY), null);
});

test('managed filter: stored operator_id drives it (true keeps managed, false unmanaged, undefined all)', () => {
  const laz = makeLocation({ source_name: 'laz', name: 'First Citizens Bank', operator_id: 'laz', operator_source: 'source' });
  const manual = makeLocation({ source_name: 'spothero', name: 'Some Lot', operator_id: 'ace-parking', operator_source: 'manual' });
  const unmanaged = makeLocation({ source_name: 'parkopedia', name: 'Knight Center Garage' });
  const all = [laz, manual, unmanaged];
  assert.equal(filterFleetSites(all, { managed: true }).length, 2);
  assert.equal(filterFleetSites(all, { managed: false }).length, 1);
  assert.equal(filterFleetSites(all, { managed: false })[0].id, unmanaged.id);
  assert.equal(filterFleetSites(all, {}).length, 3); // pure fn: no default — the route sets it
});

test('parse: managed defaults to true, any/true/false parse, junk rejected', () => {
  const bare = parseFleetQuery(new URLSearchParams(''));
  assert.equal(bare.ok, true);
  if (bare.ok) assert.equal(bare.value.query.managed, true); // the one default-on filter
  for (const v of ['any', 'true', 'false']) {
    const r = parseFleetQuery(new URLSearchParams(`managed=${v}`));
    assert.equal(r.ok, true, v);
  }
  const bad = parseFleetQuery(new URLSearchParams('managed=maybe'));
  assert.equal(bad.ok, false);
});

test('summary carries operator_id + managedBy resolved from the registry name map', () => {
  const names = new Map([['laz', 'LAZ Parking']]);
  const s = toFleetSiteSummary(makeLocation({ source_name: 'laz', name: 'Anything', operator_id: 'laz', operator_source: 'source' }), undefined, names);
  assert.equal(s.operator_id, 'laz');
  assert.equal(s.managedBy, 'LAZ Parking');
  // id not in the registry (deleted operator) -> name null, id still exposed
  const s2 = toFleetSiteSummary(makeLocation({ operator_id: 'gone' }), undefined, names);
  assert.equal(s2.managedBy, null);
  assert.equal(s2.operator_id, 'gone');
  // no operator -> both null
  const s3 = toFleetSiteSummary(makeLocation({ source_name: 'parkopedia', name: 'Knight Center Garage' }));
  assert.equal(s3.managedBy, null);
  assert.equal(s3.operator_id, null);
});

// --- demand-zone proximity ---------------------------------------------------

function makeLocationWithDemand(overrides: Partial<SourcedParkingLocation> = {}): SourcedParkingLocation {
  return makeLocation({
    enrichment: { geo: {
      checkedAt: '2026-01-01T00:00:00Z',
      demand: {
        algorithm: 'haversine-geodesic-air-miles',
        schemaVersion: 'demand-zones-miami-v1',
        configHash: 'abc123',
        checkedAt: '2026-01-01T00:00:00Z',
        nearestZoneId: 'brickell',
        nearestZoneType: 'core',
        nearestDistanceMi: 0.42,
        distancesMiByZoneId: {
          brickell: 0.42,
          downtown_miami: 1.1,
          mia_airport: 6.5,
          south_beach: 3.2,
          mid_beach: 5.1,
          wynwood_design: 2.3,
          kaseya_center: 0.9,
          miami_worldcenter: 1.0,
          bayfront_park: 0.8,
          port_miami: 2.0,
          hard_rock_stadium: 14.2,
          um_coral_gables: 4.5,
        },
      },
    } },
    ...overrides,
  });
}

test('summary carries nearestDemandZoneId and nearestDemandDistanceMi', () => {
  const s = toFleetSiteSummary(makeLocationWithDemand());
  assert.equal(s.nearestDemandZoneId, 'brickell');
  assert.equal(s.nearestDemandDistanceMi, 0.42);
});

test('summary omits demand fields when no demand context', () => {
  const s = toFleetSiteSummary(makeLocation());
  assert.equal(s.nearestDemandZoneId, undefined);
  assert.equal(s.nearestDemandDistanceMi, undefined);
});

test('maxDistToDemandMi filters by nearest distance', () => {
  const near = makeLocationWithDemand();
  const far = makeLocationWithDemand({
    enrichment: { geo: {
      checkedAt: '2026-01-01T00:00:00Z',
      demand: {
        algorithm: 'haversine-geodesic-air-miles',
        schemaVersion: 'demand-zones-miami-v1',
        configHash: 'abc123',
        checkedAt: '2026-01-01T00:00:00Z',
        nearestZoneId: 'hard_rock_stadium',
        nearestZoneType: 'venue',
        nearestDistanceMi: 14.2,
        distancesMiByZoneId: { hard_rock_stadium: 14.2 },
      },
    } },
  });
  const out = filterFleetSites([near, far], { maxDistToDemandMi: 5 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, near.id);
});

test('maxDistToDemandMi excludes lots with no demand context', () => {
  const withDemand = makeLocationWithDemand();
  const noDemand = makeLocation();
  const out = filterFleetSites([withDemand, noDemand], { maxDistToDemandMi: 5 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, withDemand.id);
});

test('maxDistToZone filters by specific zone distance', () => {
  const nearMia = makeLocationWithDemand();
  const out = filterFleetSites([nearMia], { maxDistToZone: { zoneId: 'mia_airport', maxMi: 10 } });
  assert.equal(out.length, 1);
  const out2 = filterFleetSites([nearMia], { maxDistToZone: { zoneId: 'mia_airport', maxMi: 5 } });
  assert.equal(out2.length, 0); // 6.5 mi > 5 mi
});

test('sortBy=nearest sorts by nearestDistanceMi ascending', () => {
  const close = makeLocationWithDemand();
  const far = makeLocationWithDemand({
    enrichment: { geo: {
      checkedAt: '2026-01-01T00:00:00Z',
      demand: {
        algorithm: 'haversine-geodesic-air-miles',
        schemaVersion: 'demand-zones-miami-v1',
        configHash: 'abc123',
        checkedAt: '2026-01-01T00:00:00Z',
        nearestZoneId: 'hard_rock_stadium',
        nearestZoneType: 'venue',
        nearestDistanceMi: 14.2,
        distancesMiByZoneId: { hard_rock_stadium: 14.2 },
      },
    } },
  });
  const out = filterFleetSites([far, close], { sortBy: 'nearest' });
  assert.equal(out[0].id, close.id);
  assert.equal(out[1].id, far.id);
});

test('sortBy=zoneId sorts by that specific zone distance', () => {
  const nearDowntown = makeLocationWithDemand();
  const farDowntown = makeLocationWithDemand({
    enrichment: { geo: {
      checkedAt: '2026-01-01T00:00:00Z',
      demand: {
        algorithm: 'haversine-geodesic-air-miles',
        schemaVersion: 'demand-zones-miami-v1',
        configHash: 'abc123',
        checkedAt: '2026-01-01T00:00:00Z',
        nearestZoneId: 'hard_rock_stadium',
        nearestZoneType: 'venue',
        nearestDistanceMi: 14.2,
        distancesMiByZoneId: {
          hard_rock_stadium: 14.2,
          downtown_miami: 8.0,
        },
      },
    } },
  });
  const out = filterFleetSites([farDowntown, nearDowntown], { sortBy: 'downtown_miami' });
  assert.equal(out[0].id, nearDowntown.id); // 1.1 mi < 8.0 mi
});

test('sortBy puts lots without demand context last (Infinity)', () => {
  const withDemand = makeLocationWithDemand();
  const noDemand = makeLocation();
  const out = filterFleetSites([noDemand, withDemand], { sortBy: 'nearest' });
  assert.equal(out[0].id, withDemand.id);
  assert.equal(out[1].id, noDemand.id);
});

test('parse: maxDistToDemandMi accepts non-negative number', () => {
  const r = parseFleetQuery(new URLSearchParams('maxDistToDemandMi=5.0'));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.query.maxDistToDemandMi, 5.0);
});

test('parse: maxDistToDemandMi rejects negative', () => {
  const r = parseFleetQuery(new URLSearchParams('maxDistToDemandMi=-1'));
  assert.equal(r.ok, false);
});

test('parse: maxDistToZone accepts zoneId:maxMi format', () => {
  const r = parseFleetQuery(new URLSearchParams('maxDistToZone=mia_airport:3.0'));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.query.maxDistToZone, { zoneId: 'mia_airport', maxMi: 3.0 });
  }
});

test('parse: maxDistToZone rejects unknown zoneId', () => {
  const r = parseFleetQuery(new URLSearchParams('maxDistToZone=bogus:3.0'));
  assert.equal(r.ok, false);
});

test('parse: maxDistToZone rejects bad format', () => {
  assert.equal(parseFleetQuery(new URLSearchParams('maxDistToZone=mia_airport')).ok, false);
  assert.equal(parseFleetQuery(new URLSearchParams('maxDistToZone=mia_airport:abc')).ok, false);
});

test('parse: sortBy=nearest accepted', () => {
  const r = parseFleetQuery(new URLSearchParams('sortBy=nearest'));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.query.sortBy, 'nearest');
});

test('parse: sortBy=validZoneId accepted', () => {
  const r = parseFleetQuery(new URLSearchParams('sortBy=brickell'));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.query.sortBy, 'brickell');
});

test('parse: sortBy=bogus rejected', () => {
  const r = parseFleetQuery(new URLSearchParams('sortBy=bogus'));
  assert.equal(r.ok, false);
});

test('demand filter + sort compose', () => {
  const close = makeLocationWithDemand();
  const mid = makeLocationWithDemand({
    enrichment: { geo: {
      checkedAt: '2026-01-01T00:00:00Z',
      demand: {
        algorithm: 'haversine-geodesic-air-miles',
        schemaVersion: 'demand-zones-miami-v1',
        configHash: 'abc123',
        checkedAt: '2026-01-01T00:00:00Z',
        nearestZoneId: 'kaseya_center',
        nearestZoneType: 'venue',
        nearestDistanceMi: 0.9,
        distancesMiByZoneId: { kaseya_center: 0.9, brickell: 0.42 },
      },
    } },
  });
  const far = makeLocationWithDemand({
    enrichment: { geo: {
      checkedAt: '2026-01-01T00:00:00Z',
      demand: {
        algorithm: 'haversine-geodesic-air-miles',
        schemaVersion: 'demand-zones-miami-v1',
        configHash: 'abc123',
        checkedAt: '2026-01-01T00:00:00Z',
        nearestZoneId: 'hard_rock_stadium',
        nearestZoneType: 'venue',
        nearestDistanceMi: 14.2,
        distancesMiByZoneId: { hard_rock_stadium: 14.2 },
      },
    } },
  });
  const out = filterFleetSites([far, mid, close], { maxDistToDemandMi: 5, sortBy: 'nearest' });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, close.id); // 0.42
  assert.equal(out[1].id, mid.id); // 0.9
});

console.log('fleet sites: all tests passed');
