import 'server-only';
import {
  flattenResidentialVertices,
  isResidentialAdjacent,
  parseFemaFloodResponse,
  selectGeoContextCandidates,
} from './geoContextParse.ts';
import type { LatLng } from './geoContextParse.ts';
import { listSourcedLocations, setGeoContext } from './store.ts';
import type { SourcedParkingLocation } from './types.ts';

// Recon (2026-08-23): the official FEMA endpoint named in the spec,
// hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query, is
// unreachable from every sandbox this pipeline has run in this session —
// confirmed independently twice. Every attempt (curl, Node fetch, multiple
// sub-hosts on FEMA's domain incl. msc.fema.gov, which resolves to the same
// IP) failed with a TLS connection reset (ECONNRESET) during the handshake
// itself, before any HTTP request was even sent. General internet
// (google.com), Overpass, and Esri's arcgis.com infrastructure were all
// reachable fine from the same sandbox, so this looks like FEMA's edge
// (Akamai) blocking datacenter/cloud egress IP ranges — a common
// government-WAF pattern — rather than a transient outage.
//
// TEMPORARY STAND-IN: pointed at Esri's "USA Flood Hazard Areas" hosted
// feature service instead, so this pipeline can actually run today — it's a
// live sync of the same authoritative FEMA NFHL data, same field schema
// (FLD_ZONE, ZONE_SUBTY, SFHA_TF, STATIC_BFE — FEMA's own published NFHL
// Data Dictionary, not an Esri invention). See parseFemaFloodResponse's
// header comment in geoContextParse.ts for the exact hit/miss payloads
// observed from both this mirror and (where reachable) the real endpoint.
//
// BEFORE RELYING ON THIS IN PRODUCTION: smoke-test the commented-out
// hazards.fema.gov URL below from wherever this actually deploys (Vercel
// etc.) — this sandbox's block says nothing about whether prod's network can
// reach it. If prod can reach it, swap the active URL back (same query
// params, same response shape, no other code changes needed) and delete this
// stand-in.
// const FEMA_NFHL_URL = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';
const FEMA_NFHL_URL =
  'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0/query';

/** 3-retry backoff on 429/5xx — same shape as enrichSpothero.ts's fetchWithRetry. */
async function fetchFemaFlood(lat: number, lng: number): Promise<ReturnType<typeof parseFemaFloodResponse>> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    returnGeometry: 'false',
    f: 'json',
  });

  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    res = await fetch(`${FEMA_NFHL_URL}?${params}`, { cache: 'no-store' });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`FEMA NFHL query failed: ${lastStatus || res?.status}`);
  return parseFemaFloodResponse(await res.json());
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';
// Same bbox as pitstop-finder's Miami metro config (finder.ts / config.ts).
const MIAMI_BBOX = { south: 25.74, west: -80.28, north: 25.83, east: -80.17 };

interface OverpassElement {
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/**
 * Residential-only Overpass query, one call for the whole batch (every
 * sourced record is Miami-metro). Same fetch/retry logic and residential
 * query shape as finder.ts's fetchOverpassData — not reimplemented from
 * scratch, just narrowed to residential-only (skip the parking half, we
 * don't need it here) so this doesn't require constructing a full
 * FinderConfig just to get a bbox through.
 */
async function fetchResidentialFeatures(): Promise<OverpassElement[]> {
  const { south: s, west: w, north: n, east: e } = MIAMI_BBOX;
  const query = `[out:json][timeout:180];
(
  way["landuse"~"residential"](${s},${w},${n},${e});
  way["building"="apartments"](${s},${w},${n},${e});
);
out body geom;`;
  const data = new URLSearchParams({ data: query });

  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(OVERPASS, {
      method: 'POST',
      body: data,
      headers: { 'User-Agent': 'XoomPark-GeoContext/1.0' },
      cache: 'no-store',
    });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`Overpass API error: ${lastStatus || res?.status}`);
  const json = (await res.json()) as { elements: OverpassElement[] };
  return (json.elements ?? []).filter((el) => el.tags?.landuse === 'residential' || el.tags?.building === 'apartments');
}

const FEMA_CONCURRENCY = 3;

/**
 * Batch-write geoContext (FEMA flood zone + OSM residential adjacency) onto
 * sourced records that don't have it yet. Records with no lat/lng are
 * skipped, not errored. FEMA queries fail closed per record — an error goes
 * in errors[] and that record's geoContext is left unset (never a
 * partial/guessed write). The Overpass residential fetch is a single
 * up-front call for the whole batch; if it fails, the batch still runs the
 * FEMA check for every record but omits residentialAdjacent entirely
 * (leaves it unset, not a guessed `false`) rather than failing the whole run.
 *
 * Budget check for a 60s serverless execution: at limit=50 with
 * FEMA_CONCURRENCY=3, that's ~17 sequential chunks. ArcGIS REST point
 * queries are typically sub-second to ~2s; even at 2s/call that's ~35s for
 * the FEMA half. The one up-front Overpass call for all of Miami's
 * residential ways can itself take several seconds to tens of seconds under
 * load (finder.ts's own combined query carries a 300s Overpass-side
 * timeout). Realistic total for limit=50 is on the order of 30-50s — inside
 * budget, but tight enough that a slow Overpass response could push it over.
 * If this runs from an actual serverless route (not the one-off live-run
 * script), consider a lower default limit (e.g. 20-25) or fetching
 * residential features less often than every invocation.
 */
export async function enrichGeoContextBatch(
  limit = 50,
): Promise<{ enriched: number; skipped: number; errors: string[] }> {
  const all = await listSourcedLocations();
  const { candidates, skippedNoCoords } = selectGeoContextCandidates(all, limit);

  const errors: string[] = [];
  let enriched = 0;
  if (candidates.length === 0) return { enriched: 0, skipped: skippedNoCoords, errors };

  let residentialVertices: LatLng[] | null = null;
  try {
    residentialVertices = flattenResidentialVertices(await fetchResidentialFeatures());
  } catch (err) {
    errors.push(
      `Overpass residential fetch failed (residentialAdjacent omitted for this batch): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (let i = 0; i < candidates.length; i += FEMA_CONCURRENCY) {
    const chunk = candidates.slice(i, i + FEMA_CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((record) => enrichOne(record, residentialVertices)));
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${chunk[idx].id}: ${msg}`);
      } else {
        enriched++;
      }
    });
  }

  return { enriched, skipped: skippedNoCoords, errors };
}

/** Fetch FEMA + compute residential adjacency for one record, then write. Throws on FEMA failure (fail closed — caller leaves geoContext unset). */
async function enrichOne(record: SourcedParkingLocation, residentialVertices: LatLng[] | null): Promise<void> {
  const { lat, lng } = record;
  if (lat === undefined || lng === undefined) throw new Error('missing lat/lng (should have been filtered out)');

  const flood = await fetchFemaFlood(lat, lng);
  const geoContext: NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['geo']> = {
    floodZone: flood.floodZone,
    floodHazardArea: flood.floodHazardArea,
    checkedAt: new Date().toISOString(),
  };
  if (residentialVertices) geoContext.residentialAdjacent = isResidentialAdjacent(lat, lng, residentialVertices);

  await setGeoContext(record.id, geoContext);
}
