// Pure fleet-facing projection + filtering of sourced parking locations.
// Deliberately Firestore/'server-only'-free (only imports sourcing modules
// that are themselves free of both) so it's testable with plain
// `node --experimental-strip-types`, same split as hardFilters.ts.
import type { SourcedParkingLocation } from '../sourcing/types.ts';
import { isInWaymoOdd } from '../sourcing/types.ts';
import { HARD_FILTERS, evaluateHardFilter } from '../sourcing/hardFilters.ts';
import { MIAMI_DEMAND_ZONES } from '../sourcing/demandZones.ts';

export interface FleetSiteSummary {  id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  status: string;
  surfaceType: string | null;
  gateType: string | null;
  stallsTotal: number | null;
  clearanceText?: string | null;
  access247: boolean | null;
  fenced: boolean | null;
  lit: boolean | null;
  inWaymoOdd: boolean | undefined;
  /** Detected parking operator (LAZ, InterPark, ...) — null = no management company. */
  managedBy: string | null;
  /** All 9 hard-filter evaluations — 'unknown' means "not yet walked", never a fail. */
  hardFilters: Record<string, 'pass' | 'fail' | 'unknown'>;
  /** Present only when the request carried lat/lng. */
  distanceM?: number;
  /** Nearest demand-zone anchor (from geoContext.demand). */
  nearestDemandZoneId?: string;
  nearestDemandDistanceMi?: number;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Operator-managed detection. Two signals, in priority order:
 * 1. Source — sites scraped from an operator's own site (laz.com, ipark.com)
 *    are managed by that operator by definition.
 * 2. Name — brand match for the operators Greg named (LAZ, Reimagined PMC,
 *    InterPark, Platinum, Ace, Paradise). Patterns are deliberately tight:
 *    "Ace Hardware" must never read as Ace Parking.
 * null = no management company detected.
 */
const OPERATOR_SOURCES: Record<string, string> = {
  laz: 'LAZ',
  ipark: 'InterPark',
};

const OPERATOR_NAME_PATTERNS: Array<[string, RegExp]> = [
  ['LAZ', /\blaz\b/i],
  ['InterPark', /inter\s*park|\bipark\b/i],
  ['Reimagined PMC', /reimagined|\bpmc\b/i],
  ['Platinum', /platinum\s+park/i],
  ['Ace Parking', /\bace\s+parking\b/i],
  ['Paradise', /paradise\s+park/i],
];

export function deriveOperator(location: Pick<SourcedParkingLocation, 'source' | 'name'>): string | null {
  const bySource = OPERATOR_SOURCES[location.source];
  if (bySource) return bySource;
  for (const [operator, pattern] of OPERATOR_NAME_PATTERNS) {
    if (pattern.test(location.name)) return operator;
  }
  return null;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function toFleetSiteSummary(
  location: SourcedParkingLocation,
  center?: { lat: number; lng: number },
): FleetSiteSummary {
  const hardFilters: Record<string, 'pass' | 'fail' | 'unknown'> = {};
  for (const f of HARD_FILTERS) hardFilters[f.key] = evaluateHardFilter(location, f.key).result;

  const summary: FleetSiteSummary = {
    id: location.id,
    name: location.name,
    address: location.address,
    lat: location.lat,
    lng: location.lng,
    status: location.status,
    surfaceType: location.surfaceType ?? null,
    gateType: location.gateType ?? null,
    stallsTotal: location.stallsTotal ?? null,
    clearanceText: location.clearanceText,
    access247: location.access247 ?? null,
    fenced: location.fenced ?? null,
    lit: location.lit ?? null,
    inWaymoOdd: isInWaymoOdd(location),
    managedBy: deriveOperator(location),
    hardFilters,
  };
  if (center && location.lat !== undefined && location.lng !== undefined) {
    summary.distanceM = Math.round(haversineMeters(center.lat, center.lng, location.lat, location.lng));
  }
  if (location.geoContext?.demand) {
    summary.nearestDemandZoneId = location.geoContext.demand.nearestZoneId;
    summary.nearestDemandDistanceMi = location.geoContext.demand.nearestDistanceMi;
  }
  return summary;
}

export interface FleetSiteQuery {
  center?: { lat: number; lng: number };
  radiusM?: number;
  minStalls?: number;
  surfaceType?: 'surface' | 'structured';
  gateType?: 'lpr' | 'manual' | 'automatic' | 'gateless';
  /** Explicit asks only: true requires a pass, false requires a confirmed fail. Absent = no constraint. */
  access247?: boolean;
  fenced?: boolean;
  lit?: boolean;
  /**
   * Operator management: true = managed by a parking operator only (LAZ,
   * InterPark, ...), false = no management company only, undefined = no
   * constraint. The route defaults this to true — Waymo only sees
   * operator-managed sites for now (commercial requirement: you can't
   * contract an unmanaged garage).
   */
  managed?: boolean;
  /** Max miles to the nearest demand-zone anchor. Absent = no constraint. */
  maxDistToDemandMi?: number;
  /** Max miles to a specific zone, e.g. { zoneId: 'mia_airport', maxMi: 3.0 }. */
  maxDistToZone?: { zoneId: string; maxMi: number };
  /** Sort by demand-zone distance: 'nearest' | zoneId. */
  sortBy?: string;
  limit?: number;
}

/**
 * Wide-net rule (Greg): unknown is never a fail. A filter applies ONLY when
 * explicitly requested; an absent constraint returns everything including
 * sites with unknown data. The one exception: an explicit `=true` ask
 * (e.g. fenced=true) does exclude unknowns — the fleet asked for confirmed.
 *
 * Waymo ODD is NOT optional — this API only ever returns sites inside the
 * live Waymo ODD (isInWaymoOdd). Sites without coords are dropped too.
 */
export function filterFleetSites(
  locations: SourcedParkingLocation[],
  query: FleetSiteQuery,
): SourcedParkingLocation[] {
  const radiusM = query.radiusM ?? 5_000;
  const filtered = locations.filter((loc) => {
    if (isInWaymoOdd(loc) !== true) return false;
    if (query.center) {
      if (loc.lat === undefined || loc.lng === undefined) return false;
      if (haversineMeters(query.center.lat, query.center.lng, loc.lat, loc.lng) > radiusM) return false;
    }
    if (query.minStalls !== undefined) {
      if (typeof loc.stallsTotal !== 'number' || loc.stallsTotal < query.minStalls) return false;
    }
    if (query.surfaceType !== undefined && (loc.surfaceType ?? null) !== query.surfaceType) return false;
    if (query.gateType !== undefined && (loc.gateType ?? null) !== query.gateType) return false;
    if (query.access247 !== undefined && loc.access247 !== query.access247) return false;
    if (query.fenced !== undefined && loc.fenced !== query.fenced) return false;
    if (query.lit !== undefined && loc.lit !== query.lit) return false;
    if (query.managed !== undefined && (deriveOperator(loc) !== null) !== query.managed) return false;
    if (query.maxDistToDemandMi !== undefined) {
      const dist = loc.geoContext?.demand?.nearestDistanceMi;
      if (typeof dist !== 'number' || dist > query.maxDistToDemandMi) return false;
    }
    if (query.maxDistToZone !== undefined) {
      const dist = loc.geoContext?.demand?.distancesMiByZoneId?.[query.maxDistToZone.zoneId];
      if (typeof dist !== 'number' || dist > query.maxDistToZone.maxMi) return false;
    }
    return true;
  });
  // slice(0, -1) would silently drop the LAST element — clamp so a negative
  // limit can never corrupt results if a caller bypasses route validation.
  const limit = query.limit !== undefined ? Math.max(0, query.limit) : undefined;
  const sorted = query.sortBy
    ? [...filtered].sort((a, b) => {
        const da = query.sortBy === 'nearest'
          ? a.geoContext?.demand?.nearestDistanceMi
          : a.geoContext?.demand?.distancesMiByZoneId?.[query.sortBy!];
        const db = query.sortBy === 'nearest'
          ? b.geoContext?.demand?.nearestDistanceMi
          : b.geoContext?.demand?.distancesMiByZoneId?.[query.sortBy!];
        return (da ?? Infinity) - (db ?? Infinity);
      })
    : filtered;
  return limit !== undefined ? sorted.slice(0, limit) : sorted;
}

export interface ParsedFleetQuery {
  query: FleetSiteQuery;
  /** Store-level status filter — undefined means both (wide net). */
  status?: 'draft' | 'saved';
}

/**
 * Pure translation of the discovery endpoint's query string into the filter
 * query. Returns an error string for any invalid param; absent params are
 * undefined (NOT null — null would activate the filter, the exact bug this
 * function exists to prevent: a bare GET must not constrain anything).
 */
export function parseFleetQuery(sp: URLSearchParams): { ok: true; value: ParsedFleetQuery } | { ok: false; error: string } {
  const num = (key: string): number | undefined => {
    if (!sp.has(key)) return undefined;
    const raw = sp.get(key);
    if (raw === null || raw.trim() === '') return NaN; // '' coerces to 0 otherwise — reject it
    const v = Number(raw);
    // NaN = garbage, Infinity (e.g. '1e999') = garbage too — both rejected,
    // otherwise minStalls=Infinity would silently empty the result set.
    return Number.isFinite(v) ? v : NaN;
  };

  const lat = num('lat');
  const lng = num('lng');
  if ((lat !== undefined) !== (lng !== undefined)) return { ok: false, error: 'lat and lng must be provided together' };
  if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) return { ok: false, error: 'lat must be a number between -90 and 90' };
  if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) return { ok: false, error: 'lng must be a number between -180 and 180' };

  const radiusM = num('radiusM');
  if (radiusM !== undefined && (isNaN(radiusM) || radiusM <= 0 || radiusM > 50_000)) return { ok: false, error: 'radiusM must be between 1 and 50000' };

  const minStalls = num('minStalls');
  if (minStalls !== undefined && (isNaN(minStalls) || minStalls < 0)) return { ok: false, error: 'minStalls must be a non-negative number' };

  const surfaceType = sp.get('surfaceType');
  if (surfaceType !== null && surfaceType !== 'surface' && surfaceType !== 'structured') return { ok: false, error: 'surfaceType must be surface or structured' };
  const gateType = sp.get('gateType');
  if (gateType !== null && gateType !== 'lpr' && gateType !== 'manual' && gateType !== 'automatic' && gateType !== 'gateless') return { ok: false, error: 'gateType must be lpr, manual, automatic, or gateless' };

  const status = sp.get('status');
  if (status !== null && status !== 'draft' && status !== 'saved') return { ok: false, error: 'status must be draft or saved' };

  // managed: default true (operator-managed only) — the one filter that IS
  // on by default, per the commercial requirement. 'any' opts out.
  const managedRaw = sp.get('managed');
  if (managedRaw !== null && managedRaw !== 'true' && managedRaw !== 'false' && managedRaw !== 'any') {
    return { ok: false, error: 'managed must be true, false, or any' };
  }
  const managed = managedRaw === 'any' ? undefined : managedRaw !== 'false';

  const limit = num('limit') ?? 200;
  if (isNaN(limit) || limit < 1 || limit > 1000) return { ok: false, error: 'limit must be between 1 and 1000' };

  const query: FleetSiteQuery = {
    center: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    radiusM,
    minStalls,
    surfaceType: surfaceType ?? undefined,
    gateType: gateType ?? undefined,
    managed,
    limit,
  };
  for (const key of ['access247', 'fenced', 'lit'] as const) {
    const v = sp.get(key);
    if (v === null) continue;
    if (v !== 'true' && v !== 'false') return { ok: false, error: `${key} must be true or false` };
    query[key] = v === 'true';
  }

  // Demand-zone proximity filters.
  const maxDistToDemandMi = num('maxDistToDemandMi');
  if (maxDistToDemandMi !== undefined && (isNaN(maxDistToDemandMi) || maxDistToDemandMi < 0)) {
    return { ok: false, error: 'maxDistToDemandMi must be a non-negative number' };
  }
  if (maxDistToDemandMi !== undefined) query.maxDistToDemandMi = maxDistToDemandMi;

  const maxDistToZoneRaw = sp.get('maxDistToZone');
  if (maxDistToZoneRaw !== null) {
    // Format: zoneId:maxMi  e.g. mia_airport:3.0
    const m = maxDistToZoneRaw.match(/^([\w]+):(\d+(?:\.\d+)?)$/);
    if (!m) return { ok: false, error: 'maxDistToZone must be zoneId:maxMi (e.g. mia_airport:3.0)' };
    const zoneId = m[1];
    if (!MIAMI_DEMAND_ZONES.some((z) => z.id === zoneId)) {
      return { ok: false, error: `maxDistToZone: unknown zoneId '${zoneId}'` };
    }
    query.maxDistToZone = { zoneId, maxMi: Number(m[2]) };
  }

  const sortBy = sp.get('sortBy');
  if (sortBy !== null) {
    if (sortBy === 'nearest') {
      query.sortBy = 'nearest';
    } else if (MIAMI_DEMAND_ZONES.some((z) => z.id === sortBy)) {
      query.sortBy = sortBy;
    } else {
      return { ok: false, error: `sortBy must be 'nearest' or a valid zone id` };
    }
  }

  return { ok: true, value: { query, status: status ?? undefined } };
}

/** Fields that must never leave the building via the fleet detail endpoint. */
const INTERNAL_FIELDS = ['rawInput', 'claimedBy', 'addedBy', 'fieldProvenance', 'evidence'] as const;

/**
 * Full fleet-facing detail: the summary plus geo context,
 * hours/pricing text, ingress/egress, locality, and timestamps — with the
 * internal workflow fields stripped. Returns a fresh object built from an
 * allowlist merge, so a new internal field on SourcedParkingLocation can
 * never leak by default (it has to be added here deliberately).
 */
export function toFleetSiteDetail(location: SourcedParkingLocation): Record<string, unknown> {
  const detail: Record<string, unknown> = { ...toFleetSiteSummary(location) };
  const rec = location as unknown as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (key === 'id' || INTERNAL_FIELDS.includes(key as (typeof INTERNAL_FIELDS)[number])) continue;
    if (key in detail) continue; // summary value wins (normalized form)
    detail[key] = rec[key];
  }
  return detail;
}
