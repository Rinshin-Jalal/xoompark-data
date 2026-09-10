// Pure parse/map logic for the geo-context enrichment tier (FEMA flood zone +
// OSM residential adjacency) — deliberately network- and Firestore-free (same
// split as spotheroDetailParse.ts / types.ts's buildUpsertDoc) so it runs
// under plain `node --experimental-strip-types`, no bundler, no 'server-only'
// guard tripping. See geoContext.ts for the actual fetch/store wrapper.

export interface FemaFloodResult {
  floodZone: string | null;
  floodHazardArea: boolean;
}

/**
 * Parse an ArcGIS REST query response from the FEMA NFHL Special Flood
 * Hazard Area layer (MapServer/28) into a flood result.
 *
 * Recon (2026-08-23): hazards.fema.gov itself was unreachable from the
 * sandbox this was built in (TLS connection reset on every attempt, curl and
 * Node fetch alike — see geoContext.ts's header comment for the full
 * writeup). Verified instead against Esri's "USA Flood Hazard Areas" hosted
 * feature service (services5.arcgis.com/7weheFjxuNkGGiZi/.../
 * USA_Flood_Hazard_Areas_view/FeatureServer/0), which is a synced mirror of
 * the same FEMA NFHL data using the identical NFHL field schema. A real HIT
 * (downtown Miami, 25.7700,-80.1950) returned:
 *   { "features": [{ "attributes": { "FLD_ZONE": "AE", "SFHA_TF": "T", ... } }] }
 * A real MISS (rural Kansas 38.5,-98.5, and Coral Gables 25.7215,-80.2781)
 * returned:
 *   { "features": [] }
 * SFHA_TF is the string "T"/"F", not a JSON boolean. Multiple overlapping
 * polygons take the first result — good enough at this granularity.
 */
export function parseFemaFloodResponse(json: unknown): FemaFloodResult {
  const features = (json as { features?: Array<{ attributes?: Record<string, unknown> }> } | null)?.features ?? [];
  if (features.length === 0) return { floodZone: null, floodHazardArea: false };
  const attrs = features[0]?.attributes ?? {};
  const floodZone = typeof attrs.FLD_ZONE === 'string' ? attrs.FLD_ZONE : null;
  const floodHazardArea = attrs.SFHA_TF === 'T';
  return { floodZone, floodHazardArea };
}

export interface LatLng {
  lat: number;
  lng: number;
}

// ponytail: mirrors finder.ts's haversineMi formula (meters instead of
// miles) rather than importing it. finder.ts carries a top-level
// 'server-only' import, which throws when loaded outside a react-server
// condition — importing it here would break this file's plain-node
// testability, same tradeoff types.ts documents for keeping
// computeDedupeKey/buildUpsertDoc Firestore-free. geoContext.ts (the
// server-only I/O wrapper) reuses this same exported function rather than
// having its own second copy.
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * ponytail: distance to the nearest residential-feature VERTEX, not true
 * point-to-polygon distance — a point just inside a polygon edge but far
 * from any vertex could read as "not adjacent" when it actually is.
 * Acceptable at this 150m threshold; if it needs to get tighter, or starts
 * producing visibly wrong flags, replace with a real point-to-segment
 * distance calc (finder.ts's isNearResidential already has one, via
 * pointInPolygon + distToSegmentMeters).
 */
export function isResidentialAdjacent(
  lat: number,
  lng: number,
  residentialVertices: LatLng[],
  thresholdM = 150,
): boolean {
  return residentialVertices.some((v) => haversineMeters(lat, lng, v.lat, v.lng) <= thresholdM);
}

/** Flatten Overpass `out body geom` way elements into a flat vertex list. */
export function flattenResidentialVertices(
  elements: Array<{ geometry?: Array<{ lat: number; lon: number }> }>,
): LatLng[] {
  const vertices: LatLng[] = [];
  for (const el of elements) {
    for (const p of el.geometry ?? []) vertices.push({ lat: p.lat, lng: p.lon });
  }
  return vertices;
}

/**
 * Records missing geoContext, filtered to ones with lat/lng (records without
 * coordinates are counted as skipped, never errored, and never selected).
 * Same in-memory-filter shape as enrichSpothero.ts's selectUnenrichedSpotHero
 * — fine at ~200 docs.
 */
export function selectGeoContextCandidates<T extends { lat?: number; lng?: number; geoContext?: unknown }>(
  records: T[],
  limit: number,
): { candidates: T[]; skippedNoCoords: number } {
  const missing = records.filter((r) => !r.geoContext);
  const hasCoords = (r: T) => typeof r.lat === 'number' && typeof r.lng === 'number';
  const skippedNoCoords = missing.filter((r) => !hasCoords(r)).length;
  const candidates = missing.filter(hasCoords).slice(0, limit);
  return { candidates, skippedNoCoords };
}
