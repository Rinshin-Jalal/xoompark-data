import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROBOTAXI_SERVICE_AREAS } from './robotaxiServiceAreas.ts';
import { isInOdd, isTeslaNetwork, oddZoneAt, oddZoneSearchCircle, oddZonesFor } from './odd.ts';

test('a point at a real Waymo metro center is in the Waymo ODD', () => {
  assert.equal(isInOdd(33.45, -112.074, 'waymo'), true); // Phoenix
  assert.equal(oddZoneAt(33.45, -112.074, 'waymo')?.metro, 'Phoenix');
});

test('a point far from every zone is not in the ODD for any fleet', () => {
  assert.equal(isInOdd(0, 0, 'waymo'), false);
  assert.equal(oddZoneAt(0, 0, 'waymo'), null);
});

test('ODD is fleet-specific — Las Vegas is Zoox-only, not Waymo', () => {
  const vegas = { lat: 36.107, lng: -115.1807 };
  assert.equal(isInOdd(vegas.lat, vegas.lng, 'zoox'), true);
  assert.equal(isInOdd(vegas.lat, vegas.lng, 'waymo'), false);
});

test('every fleet has at least one real zone loaded', () => {
  assert.ok(oddZonesFor('waymo').length > 0);
  assert.ok(oddZonesFor('tesla').length > 0);
  assert.ok(oddZonesFor('zoox').length > 0);
});

test('Tesla network detection (AFDC charging brand) is case-insensitive and null-safe', () => {
  assert.equal(isTeslaNetwork('Tesla'), true);
  assert.equal(isTeslaNetwork('TESLA'), true);
  assert.equal(isTeslaNetwork('ChargePoint Network'), false);
  assert.equal(isTeslaNetwork(null), false);
});

test('oddZoneSearchCircle covers every ring vertex for every zone', () => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const haversineMi = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const a =
      Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  };
  for (const zone of ROBOTAXI_SERVICE_AREAS) {
    const c = oddZoneSearchCircle(zone);
    for (const [lng, lat] of zone.ring) {
      assert.ok(
        haversineMi(c.lat, c.lng, lat, lng) <= c.radiusMiles,
        `${zone.provider}/${zone.metro}: vertex (${lat},${lng}) outside circle r=${c.radiusMiles}`,
      );
    }
  }
});
