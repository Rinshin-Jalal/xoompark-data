// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same Firestore-free style as the sourcing tests.
import assert from 'node:assert/strict';
import { computeDemandContext, haversineDistanceMiles } from '../demandDistance.ts';
import { MIAMI_DEMAND_ZONES, demandZonesConfigHash, DEMAND_ZONES_SCHEMA_VERSION, DEMAND_ZONES_ALGORITHM } from '../demandZones.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// --- Zone config integrity ---------------------------------------------------

test('12 zones defined, all with unique IDs', () => {
  assert.equal(MIAMI_DEMAND_ZONES.length, 12);
  const ids = MIAMI_DEMAND_ZONES.map((z) => z.id);
  assert.equal(new Set(ids).size, 12, 'duplicate zone IDs');
});

test('every zone has finite coordinates', () => {
  for (const z of MIAMI_DEMAND_ZONES) {
    assert.ok(Number.isFinite(z.lat), `${z.id}: lat not finite`);
    assert.ok(Number.isFinite(z.lng), `${z.id}: lng not finite`);
    assert.ok(z.lat >= -90 && z.lat <= 90, `${z.id}: lat out of range`);
    assert.ok(z.lng >= -180 && z.lng <= 180, `${z.id}: lng out of range`);
  }
});

test('every zone has provenance source', () => {
  for (const z of MIAMI_DEMAND_ZONES) {
    assert.ok(z.source && z.source.length > 0, `${z.id}: missing source provenance`);
  }
});

test('config hash is deterministic', () => {
  assert.equal(demandZonesConfigHash(), demandZonesConfigHash());
});

test('schema version and algorithm are set', () => {
  assert.equal(DEMAND_ZONES_SCHEMA_VERSION, 'demand-zones-miami-v1');
  assert.equal(DEMAND_ZONES_ALGORITHM, 'haversine-geodesic-air-miles');
});

// --- Haversine sanity ---------------------------------------------------------

test('haversine: zero distance to self', () => {
  assert.equal(haversineDistanceMiles(25.76, -80.19, 25.76, -80.19), 0);
});

test('haversine: symmetric', () => {
  const ab = haversineDistanceMiles(25.76, -80.19, 25.80, -80.20);
  const ba = haversineDistanceMiles(25.80, -80.20, 25.76, -80.19);
  assert.ok(Math.abs(ab - ba) < 1e-9);
});

// --- computeDemandContext ----------------------------------------------------

test('context has all 12 zone distances', () => {
  const ctx = computeDemandContext(25.76, -80.19);
  assert.equal(Object.keys(ctx.distancesMiByZoneId).length, 12);
  for (const z of MIAMI_DEMAND_ZONES) {
    assert.ok(z.id in ctx.distancesMiByZoneId, `missing zone ${z.id}`);
  }
});

test('context has algorithm, schemaVersion, configHash', () => {
  const ctx = computeDemandContext(25.76, -80.19);
  assert.equal(ctx.algorithm, DEMAND_ZONES_ALGORITHM);
  assert.equal(ctx.schemaVersion, DEMAND_ZONES_SCHEMA_VERSION);
  assert.equal(ctx.configHash, demandZonesConfigHash());
});

test('nearestZoneId is the minimum distance zone', () => {
  const ctx = computeDemandContext(25.76, -80.19);
  const minDist = Math.min(...Object.values(ctx.distancesMiByZoneId));
  assert.equal(ctx.nearestDistanceMi, minDist);
  assert.equal(ctx.distancesMiByZoneId[ctx.nearestZoneId], minDist);
});

test('all distances are finite non-negative', () => {
  const ctx = computeDemandContext(25.76, -80.19);
  for (const [id, dist] of Object.entries(ctx.distancesMiByZoneId)) {
    assert.ok(Number.isFinite(dist), `${id}: distance not finite`);
    assert.ok(dist >= 0, `${id}: distance negative`);
  }
});

test('full precision stored (not rounded to 2 decimals)', () => {
  const ctx = computeDemandContext(25.85, -80.18);
  // At least one distance should have more than 2 decimal places.
  const hasFullPrecision = Object.values(ctx.distancesMiByZoneId).some(
    (d) => Math.round(d * 100) / 100 !== d,
  );
  assert.ok(hasFullPrecision, 'distances appear rounded to 2 decimals');
});

// --- Acceptance criteria from spec -------------------------------------------

test('AC: Brickell Village lot resolves nearestZoneId=brickell, distance <= 0.35 mi', () => {
  // Mary Brickell Village area
  const ctx = computeDemandContext(25.7617, -80.1918);
  assert.equal(ctx.nearestZoneId, 'brickell');
  assert.ok(ctx.nearestDistanceMi <= 0.35, `expected <= 0.35, got ${ctx.nearestDistanceMi}`);
});

test('AC: lot near MIA resolves nearestZoneId=mia_airport', () => {
  // Doral / NW 36th St area, near MIA
  const ctx = computeDemandContext(25.808, -80.288);
  assert.equal(ctx.nearestZoneId, 'mia_airport');
  assert.ok(ctx.nearestDistanceMi <= 2.5, `expected <= 2.5, got ${ctx.nearestDistanceMi}`);
});

test('AC: lot at zone point has distance 0 to that zone', () => {
  for (const z of MIAMI_DEMAND_ZONES) {
    const ctx = computeDemandContext(z.lat, z.lng);
    assert.equal(ctx.distancesMiByZoneId[z.id], 0, `${z.id}: distance to self not 0`);
  }
});

test('AC: no weighted score in output', () => {
  const ctx = computeDemandContext(25.76, -80.19) as unknown as Record<string, unknown>;
  for (const banned of ['score', 'demandScore', 'weightedScore', 'suitabilityScore']) {
    assert.ok(!(banned in ctx), `${banned} found in demand context`);
  }
});

// --- Deterministic tie-breaking ----------------------------------------------

test('tie-breaking: nearestDistanceMi equals the stored distance for nearestZoneId', () => {
  // The core invariant: nearestDistanceMi must equal
  // distancesMiByZoneId[nearestZoneId], and that must be the global minimum.
  // This is already tested above but let's verify with a different point.
  const ctx = computeDemandContext(25.85, -80.15);
  assert.equal(ctx.nearestDistanceMi, ctx.distancesMiByZoneId[ctx.nearestZoneId]);
  const allDists = Object.values(ctx.distancesMiByZoneId);
  assert.equal(ctx.nearestDistanceMi, Math.min(...allDists));
});

// --- ODD independence (demand distance is not ODD membership) ------------------

test('ODD independence: a lot far from all zones still gets a real distance', () => {
  // Homestead — far south, likely outside Waymo ODD
  const ctx = computeDemandContext(25.525, -80.412);
  assert.ok(ctx.nearestDistanceMi > 10, `expected > 10 mi, got ${ctx.nearestDistanceMi}`);
  assert.ok(ctx.nearestZoneId, 'should still have a nearest zone');
});

console.log('demandDistance: all tests passed');
