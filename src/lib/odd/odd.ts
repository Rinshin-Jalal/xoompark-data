import { ROBOTAXI_SERVICE_AREAS, type FleetOperator, type RobotaxiServiceArea } from './robotaxiServiceAreas.ts';

export type { FleetOperator, RobotaxiServiceArea };
export { ROBOTAXI_SERVICE_AREAS };

export const FLEET_OPERATORS: FleetOperator[] = ['waymo', 'tesla', 'zoox'];

export const FLEET_LABEL: Record<FleetOperator, string> = {
  waymo: 'Waymo',
  tesla: 'Tesla',
  zoox: 'Zoox',
};

/** Every real ODD boundary for one fleet operator, across all its metros. */
export function oddZonesFor(fleet: FleetOperator): RobotaxiServiceArea[] {
  return ROBOTAXI_SERVICE_AREAS.filter((z) => z.provider === fleet);
}

// Standard ray-casting point-in-polygon on a [lng, lat] ring — same ~15-line
// shape as ringContains in scripts/robotaxi-charging-analysis.ts (that script
// re-derives it too rather than pull in a turf dependency for this one check).
function ringContains(ring: [number, number][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** The real ODD boundary a point falls inside for a given fleet, if any. */
export function oddZoneAt(lat: number, lng: number, fleet: FleetOperator): RobotaxiServiceArea | null {
  return oddZonesFor(fleet).find((z) => ringContains(z.ring, lng, lat)) ?? null;
}

export function isInOdd(lat: number, lng: number, fleet: FleetOperator): boolean {
  return oddZoneAt(lat, lng, fleet) !== null;
}

/**
 * Bounding-circle cover for a zone: bbox center + haversine distance to the
 * farthest vertex (+5% margin). Used to seed an AFDC radius search that is
 * guaranteed to contain the whole polygon — the caller's isInOdd filter then
 * clips the results down to the actual boundary.
 */
export function oddZoneSearchCircle(zone: RobotaxiServiceArea): { lat: number; lng: number; radiusMiles: number } {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of zone.ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const lat = (minLat + maxLat) / 2;
  const lng = (minLng + maxLng) / 2;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let maxMi = 0;
  for (const [vLng, vLat] of zone.ring) {
    const a =
      Math.sin(toRad(vLat - lat) / 2) ** 2 +
      Math.cos(toRad(lat)) * Math.cos(toRad(vLat)) * Math.sin(toRad(vLng - lng) / 2) ** 2;
    maxMi = Math.max(maxMi, 3958.8 * 2 * Math.asin(Math.sqrt(a)));
  }
  return { lat, lng, radiusMiles: Math.ceil(maxMi * 1.05) };
}

/** AFDC charging-network filter — "Tesla Supercharger" as a network brand, unrelated to the Tesla robotaxi fleet's ODD above. */
export function isTeslaNetwork(network: string | null): boolean {
  return /tesla/i.test(network ?? '');
}
