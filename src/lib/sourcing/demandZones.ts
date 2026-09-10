// Miami demand-zone anchor configuration for AV fleet deadhead-distance
// screening. Pure constants — no Firestore, no server-only, importable from
// anywhere.
//
// COORDINATE PROVENANCE: Every coordinate is sourced from existing vetted
// codebase data (pitstop-finder/lib/config.ts Miami anchors or
// sourcing/locality.ts LOCALITY_CENTERS) or a well-known public coordinate
// with documented source. No hand-guessed points.
//
// See docs/demand-zones-spec.md for the research behind these anchors.

export type DemandZoneType = 'core' | 'district' | 'airport' | 'port' | 'university' | 'venue';

export interface DemandZone {
  id: string;
  name: string;
  type: DemandZoneType;
  lat: number;
  lng: number;
  /** Where this coordinate was vetted — for audit trail. */
  source: string;
}

/**
 * 12 anchor nodes covering Miami's primary urban core, intermodal gateways,
* surge venues, and university campus. Coordinates sourced from existing
 * codebase data where available; two new points (PortMiami, Hard Rock Stadium)
 * use well-known public coordinates.
 *
 * NOT a claim of 90% demand coverage — no observed trip dataset exists to
 * establish that. These are defensible static proxies for rider-demand
 * concentration.
 */
export const MIAMI_DEMAND_ZONES: readonly DemandZone[] = [
  { id: 'brickell', name: 'Brickell', type: 'core', lat: 25.7617, lng: -80.1918, source: 'pitstop-finder/lib/config.ts' },
  { id: 'downtown_miami', name: 'Downtown Miami', type: 'core', lat: 25.7743, lng: -80.1937, source: 'locality.ts LOCALITY_CENTERS' },
  { id: 'kaseya_center', name: 'Kaseya Center', type: 'venue', lat: 25.7814, lng: -80.187, source: 'pitstop-finder/lib/config.ts' },
  { id: 'miami_worldcenter', name: 'Miami Worldcenter', type: 'district', lat: 25.7847, lng: -80.193, source: 'pitstop-finder/lib/config.ts' },
  { id: 'wynwood_design', name: 'Wynwood / Design District', type: 'district', lat: 25.807, lng: -80.196, source: 'locality.ts LOCALITY_CENTERS' },
  { id: 'bayfront_park', name: 'Bayfront Park', type: 'venue', lat: 25.7754, lng: -80.1863, source: 'pitstop-finder/lib/config.ts' },
  // ponytail: beach zones are elongated — a single point can't represent the
  // full span. south_beach anchor is ~Lincoln Rd; a lot at the north end of
  // South Beach may read 1.5+ mi from its own neighborhood. Acceptable for v1
  // screening ("roughly close to demand"); upgrade to multi-point or polygon
  // if screening precision ever matters.
  { id: 'south_beach', name: 'South Beach', type: 'district', lat: 25.7825, lng: -80.1341, source: 'locality.ts LOCALITY_CENTERS' },
  { id: 'mid_beach', name: 'Mid Beach', type: 'district', lat: 25.84, lng: -80.121, source: 'locality.ts LOCALITY_CENTERS' },
  { id: 'mia_airport', name: 'Miami International Airport', type: 'airport', lat: 25.808, lng: -80.288, source: 'locality.ts LOCALITY_CENTERS' },
  { id: 'port_miami', name: 'PortMiami', type: 'port', lat: 25.778, lng: -80.176, source: 'public: PortMiami cruise terminals' },
  { id: 'hard_rock_stadium', name: 'Hard Rock Stadium', type: 'venue', lat: 25.958, lng: -80.239, source: 'public: Hard Rock Stadium, Miami Gardens' },
  { id: 'um_coral_gables', name: 'UM / Coral Gables', type: 'university', lat: 25.7215, lng: -80.2684, source: 'locality.ts LOCALITY_CENTERS' },
] as const;

/** Schema version — changes when zones are added/removed/moved. */
export const DEMAND_ZONES_SCHEMA_VERSION = 'demand-zones-miami-v1';

/** Algorithm identifier stored alongside distances for auditability. */
export const DEMAND_ZONES_ALGORITHM = 'haversine-geodesic-air-miles';

/**
 * Deterministic config hash from the canonical zone configuration. Used for
 * idempotency: a stored demand context whose configHash doesn't match is
 * stale and must be recomputed. Changes when any zone id/lat/lng changes.
 */
export function demandZonesConfigHash(): string {
  // Stable: sorted by id, full precision, no whitespace variation.
  const canonical = MIAMI_DEMAND_ZONES
    .map((z) => `${z.id}:${z.lat}:${z.lng}`)
    .sort()
    .join('|');
  // Simple hash — not cryptographic, just deterministic.
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) - hash + canonical.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
