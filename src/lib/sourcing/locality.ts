// Pure keyword-match derivation of which of the 12 canonical Miami
// localities (docs/bdr-workflow.md §0.5) an address belongs to. Deliberately
// Firestore-free (same split as hardFilters.ts / geoContextParse.ts) so it's
// testable with plain `node --experimental-strip-types` and importable from
// both store.ts (write-path hook + backfill script) and the tracker UI.
//
// "Empty beats wrong" — same principle as the rest of this pipeline
// (buildUpsertDoc, evaluateHardFilter): no match, or more than one match,
// returns null rather than guessing.

/** The canonical localities, in display order everywhere (tracker UI,
 * backfill report). Started as 12 urban-core neighborhoods (docs/
 * bdr-workflow.md §0.5 v1); expanded to cover Miami-Dade more broadly —
 * every named city/area a BDR could plausibly be assigned to hunt. */
export const LOCALITIES: string[] = [
  'Brickell',
  'Downtown / Central Business District',
  'Edgewater / Midtown',
  'Wynwood / Design District',
  'Overtown / Allapattah',
  'Little Havana / Shenandoah',
  'Coral Way / The Roads',
  'Coconut Grove',
  'Coral Gables',
  'South Miami',
  'Pinecrest',
  'Kendall',
  'Westchester / Flagami',
  'Doral',
  'Hialeah',
  'Miami Lakes',
  'Airport / Miami Springs',
  'Miami Gardens',
  'North Miami',
  'North Miami Beach',
  'Aventura',
  'Sunny Isles Beach',
  'South Beach',
  'Mid Beach / North Beach',
  'Key Biscayne',
  'Homestead / Cutler Bay',
];

// Keyword -> canonical locality name. Keywords are the locality's own name
// parts plus common variants explicitly groundable in the doc's "Landmarks /
// bounds hint" column (§0.5) — no zip-code or lat/lng guessing invented
// beyond what the doc states. Matched case-insensitively as substrings.
const KEYWORD_TO_LOCALITY: { keyword: string; locality: string }[] = [
  { keyword: 'brickell', locality: 'Brickell' },

  { keyword: 'downtown', locality: 'Downtown / Central Business District' },
  { keyword: 'central business district', locality: 'Downtown / Central Business District' },
  { keyword: 'cbd', locality: 'Downtown / Central Business District' },

  { keyword: 'edgewater', locality: 'Edgewater / Midtown' },
  { keyword: 'midtown', locality: 'Edgewater / Midtown' },

  { keyword: 'wynwood', locality: 'Wynwood / Design District' },
  { keyword: 'design district', locality: 'Wynwood / Design District' },

  { keyword: 'south beach', locality: 'South Beach' },

  { keyword: 'mid beach', locality: 'Mid Beach / North Beach' },
  { keyword: 'north beach', locality: 'Mid Beach / North Beach' },

  { keyword: 'coconut grove', locality: 'Coconut Grove' },

  { keyword: 'little havana', locality: 'Little Havana / Shenandoah' },
  { keyword: 'shenandoah', locality: 'Little Havana / Shenandoah' },

  { keyword: 'coral way', locality: 'Coral Way / The Roads' },
  { keyword: 'the roads', locality: 'Coral Way / The Roads' },

  { keyword: 'overtown', locality: 'Overtown / Allapattah' },
  { keyword: 'allapattah', locality: 'Overtown / Allapattah' },

  { keyword: 'key biscayne', locality: 'Key Biscayne' },

  { keyword: 'miami springs', locality: 'Airport / Miami Springs' },
  { keyword: 'miami international airport', locality: 'Airport / Miami Springs' },

  { keyword: 'coral gables', locality: 'Coral Gables' },

  { keyword: 'south miami', locality: 'South Miami' },

  { keyword: 'pinecrest', locality: 'Pinecrest' },

  { keyword: 'kendall', locality: 'Kendall' },

  { keyword: 'westchester', locality: 'Westchester / Flagami' },
  { keyword: 'flagami', locality: 'Westchester / Flagami' },

  { keyword: 'doral', locality: 'Doral' },

  { keyword: 'hialeah', locality: 'Hialeah' },

  { keyword: 'miami lakes', locality: 'Miami Lakes' },

  { keyword: 'miami gardens', locality: 'Miami Gardens' },

  { keyword: 'north miami beach', locality: 'North Miami Beach' },
  { keyword: 'north miami', locality: 'North Miami' },

  { keyword: 'aventura', locality: 'Aventura' },

  { keyword: 'sunny isles', locality: 'Sunny Isles Beach' },

  { keyword: 'homestead', locality: 'Homestead / Cutler Bay' },
  { keyword: 'cutler bay', locality: 'Homestead / Cutler Bay' },
];

/** Reference point for each canonical locality (docs/bdr-workflow.md §0.5) —
 * also the Voronoi seed HuntCoverageMap.tsx grows each coverage cell from,
 * so a nearest-center match here always agrees with the cell a lot's pin
 * visibly lands in on that map. Approximate (nearest-nameable-point, not an
 * official boundary — no such per-locality data exists), same caveat as the
 * map's own comment. */
export const LOCALITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  'Brickell': { lat: 25.7617, lng: -80.1918 },
  'Downtown / Central Business District': { lat: 25.7743, lng: -80.1937 },
  'Edgewater / Midtown': { lat: 25.807, lng: -80.19 },
  'Wynwood / Design District': { lat: 25.807, lng: -80.196 },
  'Overtown / Allapattah': { lat: 25.798, lng: -80.212 },
  'Little Havana / Shenandoah': { lat: 25.7654, lng: -80.2201 },
  'Coral Way / The Roads': { lat: 25.748, lng: -80.222 },
  'Coconut Grove': { lat: 25.7279, lng: -80.2436 },
  'Coral Gables': { lat: 25.7215, lng: -80.2684 },
  'South Miami': { lat: 25.7079, lng: -80.2939 },
  'Pinecrest': { lat: 25.6664, lng: -80.3081 },
  'Kendall': { lat: 25.6795, lng: -80.3173 },
  'Westchester / Flagami': { lat: 25.747, lng: -80.3277 },
  'Doral': { lat: 25.8195, lng: -80.3553 },
  'Hialeah': { lat: 25.8576, lng: -80.2781 },
  'Miami Lakes': { lat: 25.9101, lng: -80.3134 },
  'Airport / Miami Springs': { lat: 25.808, lng: -80.288 },
  'Miami Gardens': { lat: 25.942, lng: -80.2456 },
  'North Miami': { lat: 25.8901, lng: -80.1867 },
  'North Miami Beach': { lat: 25.9331, lng: -80.1625 },
  'Aventura': { lat: 25.9565, lng: -80.1392 },
  'Sunny Isles Beach': { lat: 25.942, lng: -80.1225 },
  'South Beach': { lat: 25.7825, lng: -80.1341 },
  'Mid Beach / North Beach': { lat: 25.84, lng: -80.121 },
  'Key Biscayne': { lat: 25.6931, lng: -80.1625 },
  'Homestead / Cutler Bay': { lat: 25.525, lng: -80.412 },
};

// Meters per degree, at Miami's latitude — a flat-earth approximation
// (equirectangular projection) that's plenty accurate for nearest-center
// comparisons over a single county, not a true haversine.
const METERS_PER_DEG_LAT = 110_574;
const METERS_PER_DEG_LNG = 111_320 * Math.cos((25.77 * Math.PI) / 180);

// Beyond this, "nearest center" stops meaning anything (a bad geocode
// landing in the Everglades or another state) — "empty beats wrong" applies
// to coordinates same as it does to address keywords below.
const MAX_LOCALITY_DISTANCE_METERS = 40_000;

function nearestLocality(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [name, c] of Object.entries(LOCALITY_CENTERS)) {
    const dLat = (lat - c.lat) * METERS_PER_DEG_LAT;
    const dLng = (lng - c.lng) * METERS_PER_DEG_LNG;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return bestDist <= MAX_LOCALITY_DISTANCE_METERS ? best : null;
}

/**
 * Locality for a lot: nearest-center match against real lat/lng when both
 * are given (see LOCALITY_CENTERS) — actual coordinates beat guessing from
 * text. Falls back to keyword-matching the address string when coordinates
 * are missing or too far from every center to trust. Returns null rather
 * than guessing when neither source resolves cleanly (0 keyword matches, or
 * keywords for two DIFFERENT localities both appear — a genuinely ambiguous
 * address).
 */
export function deriveLocality(address?: string, lat?: number, lng?: number): string | null {
  if (typeof lat === 'number' && typeof lng === 'number') {
    const byCoords = nearestLocality(lat, lng);
    if (byCoords) return byCoords;
  }

  if (!address) return null;
  const haystack = address.toLowerCase();

  const hits = KEYWORD_TO_LOCALITY.filter(({ keyword }) => haystack.includes(keyword));
  if (hits.length === 0) return null;

  // A keyword that's a literal substring of another matched keyword for a
  // DIFFERENT locality is specificity, not ambiguity — e.g. "north miami"
  // matches inside "North Miami Beach" too, but that's not two localities
  // both being mentioned, it's one name nested inside another. Drop the
  // less-specific (shorter) match in that case; only keywords that are
  // genuinely independent substrings count toward ambiguity.
  const specific = hits.filter(
    (hit) => !hits.some((other) => other.locality !== hit.locality && other.keyword.includes(hit.keyword) && other.keyword !== hit.keyword),
  );

  const matched = new Set(specific.map((h) => h.locality));
  if (matched.size !== 1) return null; // 0 = no match, 2+ = genuinely ambiguous
  return [...matched][0];
}

// --- Locality tracker (pure counting, consumed by store's backfill script
// and by the admin/BDR tracker UIs — same "pure logic + thin UI/IO wrapper"
// split as hardFilters.ts's summary-strip counting) --------------------------

import type { SourcedParkingLocation } from './types.ts';

// The soft/hard-filter fields counted toward "enriched" — deliberately
// excludes identity fields (name/address/lat/lng) since those aren't BDR
// enrichment work. Empty-check per field matches the same conventions
// already established in bdrView.ts's CHECKLIST_FIELDS: tri-state booleans
// (access247/fenced/lit) treat only `undefined` as empty (`null` = "checked,
// couldn't tell", a real recorded fact); stallsTotal requires an actual
// number; surfaceType/gateType treat their `null` default (buildUpsertDoc's
// untouched-field default) as empty, unlike the tri-state booleans above.
const ENRICHMENT_FIELD_EMPTY: Record<string, (l: SourcedParkingLocation) => boolean> = {
  priceText: (l) => !l.priceText,
  hoursText: (l) => !l.hoursText,
  capacityText: (l) => !l.capacityText,
  surfaceType: (l) => l.surfaceType == null,
  gateType: (l) => l.gateType == null,
  clearanceText: (l) => !l.clearanceText,
  access247: (l) => l.access247 === undefined,
  fenced: (l) => l.fenced === undefined,
  lit: (l) => l.lit === undefined,
  ingressEgress: (l) => !l.ingressEgress,
  stallsTotal: (l) => typeof l.stallsTotal !== 'number',
};

export const ENRICHMENT_FIELDS: string[] = Object.keys(ENRICHMENT_FIELD_EMPTY);

/** A record counts as "enriched" once at least this many of the 11 fields
 * above are non-empty. */
export const ENRICHMENT_THRESHOLD = 5;

export function isEnriched(location: SourcedParkingLocation): boolean {
  let filled = 0;
  for (const key of ENRICHMENT_FIELDS) {
    if (!ENRICHMENT_FIELD_EMPTY[key](location)) filled++;
  }
  return filled >= ENRICHMENT_THRESHOLD;
}

export interface LocalityStat {
  locality: string;
  lotCount: number;
  enrichedCount: number;
  savedCount: number;
  needsHunt: boolean;
}

/**
 * Per-locality lot/enriched/saved counts + a needs-hunt flag, over every
 * canonical locality (localities with 0 lots still get a row).
 *
 * ponytail: needs-hunt is a simple placeholder heuristic — lotCount < 20% of
 * the BEST-covered locality's count. Deliberately max-based, not median-based
 * (an earlier version used the median): with dozens of localities and most
 * starting at zero lots, the median collapses to 0 and the threshold never
 * trips for anything, silently erasing the "needs hunt" tier. Max stays
 * meaningful as long as at least one locality has data. Tune the
 * shape/threshold once there's more real per-locality data; this is not
 * meant to be a permanent design.
 */
export function localityStats(locations: SourcedParkingLocation[]): LocalityStat[] {
  const byLocality = new Map<string, SourcedParkingLocation[]>();
  for (const name of LOCALITIES) byLocality.set(name, []);
  for (const loc of locations) {
    if (loc.locality && byLocality.has(loc.locality)) byLocality.get(loc.locality)!.push(loc);
  }

  const counts = LOCALITIES.map((name) => byLocality.get(name)!.length);
  const threshold = Math.max(...counts) * 0.2;

  return LOCALITIES.map((name) => {
    const locs = byLocality.get(name)!;
    return {
      locality: name,
      lotCount: locs.length,
      enrichedCount: locs.filter(isEnriched).length,
      savedCount: locs.filter((l) => l.status === 'saved').length,
      needsHunt: locs.length < threshold,
    };
  });
}

/** Records with no derived locality (deriveLocality returned null, or the
 * backfill hasn't run on them yet) — the "unassigned" count the backfill
 * report and tracker UI both surface. */
export function countUnassignedLocality(locations: SourcedParkingLocation[]): number {
  return locations.filter((l) => !l.locality).length;
}
