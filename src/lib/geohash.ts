import { bboxes } from 'ngeohash';

export function geohashPrecision(radiusMeters: number): number {
  if (radiusMeters <= 150) return 7;
  if (radiusMeters <= 1200) return 6;
  if (radiusMeters <= 5000) return 5;
  if (radiusMeters <= 20000) return 4;
  return 3;
}

export function geohashBboxes(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): string[] {
  const precision = geohashPrecision(radiusMeters);
  const latDelta = radiusMeters / 111320;
  const lngDelta =
    radiusMeters / (111320 * Math.max(0.001, Math.cos((centerLat * Math.PI) / 180)));
  const minLat = Math.max(-90, centerLat - latDelta);
  const maxLat = Math.min(90, centerLat + latDelta);
  const minLng = Math.max(-180, centerLng - lngDelta);
  const maxLng = Math.min(180, centerLng + lngDelta);
  return [...new Set(bboxes(minLat, minLng, maxLat, maxLng, precision))].sort();
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
