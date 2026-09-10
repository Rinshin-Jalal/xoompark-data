// Pure haversine distance + demand-context computation — no Firestore, no
// server-only, testable with plain `node --experimental-strip-types`.
// Same split as hardFilters.ts / types.ts.
//
// ponytail: haversineMi() already exists in pitstop-finder/lib/finder.ts with
// the same formula and R=3958.8, but that file has `import 'server-only'` so
// it can't be imported here. This is a 6-line duplicate; move to a shared util
// if a third consumer appears.
import {
  MIAMI_DEMAND_ZONES,
  DEMAND_ZONES_SCHEMA_VERSION,
  DEMAND_ZONES_ALGORITHM,
  demandZonesConfigHash,
} from './demandZones.ts';
import type { DemandZoneType } from './demandZones.ts';

const EARTH_RADIUS_MILES = 3958.8;

export function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(a));
}

export interface LotDemandContext {
  algorithm: string;
  schemaVersion: string;
  configHash: string;
  checkedAt: string; // ISO 8601
  nearestZoneId: string;
  nearestZoneType: DemandZoneType;
  nearestDistanceMi: number; // full precision — round only at presentation
  distancesMiByZoneId: Record<string, number>;
}

/**
 * Compute the full demand-distance vector for a lot: haversine miles to each
 * of the 12 Miami anchor nodes, plus the nearest zone summary. O(N×K) where
 * N=1 lot, K=12 zones — zero network calls, zero polygon math.
 *
 * Tie-breaking: minimum distance, then stable ID (lexicographic) — so two
 * zones at the exact same distance always resolve to the same winner
 * deterministically.
 */
export function computeDemandContext(lotLat: number, lotLng: number): LotDemandContext {
  const distances: Record<string, number> = {};
  let nearestId = '';
  let nearestType: DemandZoneType = 'core';
  let nearestDist = Infinity;

  for (const zone of MIAMI_DEMAND_ZONES) {
    const dist = haversineDistanceMiles(lotLat, lotLng, zone.lat, zone.lng);
    distances[zone.id] = dist;

    // Deterministic: strictly less-than (not <=) so the first zone at a given
    // distance wins, and zones are iterated in array order (stable IDs in
    // alphabetical order within the const array). If two zones tie, the one
    // earlier in the array wins — which is deterministic but not lexicographic.
    // For full lexicographic tie-breaking, compare IDs when distances are equal:
    if (dist < nearestDist || (dist === nearestDist && zone.id < nearestId)) {
      nearestDist = dist;
      nearestId = zone.id;
      nearestType = zone.type;
    }
  }

  return {
    algorithm: DEMAND_ZONES_ALGORITHM,
    schemaVersion: DEMAND_ZONES_SCHEMA_VERSION,
    configHash: demandZonesConfigHash(),
    checkedAt: new Date().toISOString(),
    nearestZoneId: nearestId,
    nearestZoneType: nearestType,
    nearestDistanceMi: nearestDist,
    distancesMiByZoneId: distances,
  };
}
