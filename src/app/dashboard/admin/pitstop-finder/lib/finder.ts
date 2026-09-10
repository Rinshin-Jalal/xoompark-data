import 'server-only';
import type { FinderConfig, MetroCode } from '@/lib/types';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

// ===== Geometry & Distance =====

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function polygonAreaSqm(points: Array<{ lat: number; lng: number }>): number | null {
  if (!points || points.length < 3) return null;

  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p.lng * 111320.0 * k);
  const ys = points.map((p) => p.lat * 110540.0);

  let area = 0;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    area += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(area) / 2.0;
}

// ===== Overpass API =====

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lng?: number;
  center?: { lat: number; lng: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lng: number }>;
}

export async function fetchOverpassData(config: FinderConfig): Promise<{
  parking: OverpassElement[];
  residential: OverpassElement[];
}> {
  const { bounding_box } = config;
  const s = bounding_box.south, w = bounding_box.west, n = bounding_box.north, e = bounding_box.east;

  // Combined query: parking + residential in one call, minimizing API requests
  const query = `[out:json][timeout:300];
(
  node["amenity"="parking"](${s},${w},${n},${e});
  way["amenity"="parking"](${s},${w},${n},${e});
  relation["amenity"="parking"](${s},${w},${n},${e});
  way["landuse"~"residential"](${s},${w},${n},${e});
  way["building"="apartments"](${s},${w},${n},${e});
);
out body geom;`;

  const data = new URLSearchParams({ data: query });

  // The public Overpass instance is a shared resource and returns transient
  // 429/502/503/504 under load — retry with backoff before giving up.
  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const req = new Request(OVERPASS, {
      method: 'POST',
      body: data,
      headers: { 'User-Agent': 'XoomPark-PitstopFinder/2.0' },
    });
    res = await fetch(req, { cache: 'no-store' });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`Overpass API error: ${lastStatus || res?.status}`);
  const json = (await res.json()) as { elements: OverpassElement[] };

  const parking: OverpassElement[] = [];
  const residential: OverpassElement[] = [];

  for (const el of json.elements || []) {
    const tags = el.tags ?? {};
    if (tags.amenity === 'parking') {
      parking.push(el);
    } else if (tags.landuse === 'residential' || tags.building === 'apartments') {
      residential.push(el);
    }
  }

  return { parking, residential };
}

// ===== Residential Penalty =====

interface ResidentialWay {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  points: Array<{ lat: number; lng: number }>;
}

export function buildResidentialWays(residential: OverpassElement[]): ResidentialWay[] {
  const ways: ResidentialWay[] = [];
  for (const el of residential) {
    const points = el.geometry;
    if (!points || points.length < 3) continue;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lng); maxLon = Math.max(maxLon, p.lng);
    }
    ways.push({ minLat, maxLat, minLon, maxLon, points });
  }
  return ways;
}

function projectMeters(
  centerLat: number,
  centerLon: number,
  lat: number,
  lng: number,
): { x: number; y: number } {
  const metersPerDegreeLat = 110540;
  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  return {
    x: (lng - centerLon) * metersPerDegreeLon,
    y: (lat - centerLat) * metersPerDegreeLat,
  };
}

function pointInPolygon(polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegmentMeters(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): number {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-p1.x * dx - p1.y * dy) / lenSq));
  return Math.sqrt((p1.x + t * dx) ** 2 + (p1.y + t * dy) ** 2);
}

export function isNearResidential(
  lat: number,
  lng: number,
  ways: ResidentialWay[],
  bufferM: number,
): boolean {
  const pad = (bufferM * 1.5) / 111_000;
  for (const way of ways) {
    if (lat < way.minLat - pad || lat > way.maxLat + pad || lng < way.minLon - pad || lng > way.maxLon + pad) continue;
    const poly = way.points.map((p) => projectMeters(lat, lng, p.lat, p.lng));
    if (pointInPolygon(poly)) return true;
    for (let i = 0; i < poly.length - 1; i++) {
      if (distToSegmentMeters(poly[i], poly[i + 1]) <= bufferM) return true;
    }
  }
  return false;
}

// ===== Scoring =====

export interface ScoredSite {
  osm_id: string;
  lat: number;
  lng: number;
  name: string;
  type: string;
  capacity: number | null;
  capacity_source: string;
  area_sqm: number | null;
  storage_score: number;
  staging_score: number;
  nearest_anchor_name: string;
  distance_to_anchor_miles: number;
  residential_flag: string;
  distance_to_res_meters: number | null;
  is_owner_direct_candidate: boolean;
  access: string;
  fee: string;
  distance_to_depot_miles: number | null;
  is_walk_list_ready: boolean;
  opening_hours: string | null;
}

export function scoreSite(
  el: OverpassElement,
  config: FinderConfig,
  residentialWays: ResidentialWay[],
): ScoredSite | null {
  const tags = el.tags ?? {};
  let lat = el.lat ?? el.center?.lat;
  let lng = el.lng ?? el.center?.lng;
  // Ways/relations fetched with `out body geom` carry no lat/center — only a
  // geometry ring. Fall back to its centroid (matches the original finder.py).
  if (lat === undefined && el.geometry && el.geometry.length > 0) {
    lat = el.geometry.reduce((sum, p) => sum + p.lat, 0) / el.geometry.length;
    lng = el.geometry.reduce((sum, p) => sum + p.lng, 0) / el.geometry.length;
  }
  if (lat === undefined || lng === undefined) return null;

  const ptype = tags.parking ?? '';
  const capRaw = tags.capacity;
  const cap = capRaw !== undefined ? Number.parseInt(capRaw, 10) : null;
  const cap_ = Number.isNaN(cap) ? null : cap;
  const access = tags.access ?? '';
  const name = (tags.name || tags.operator || `unnamed ${ptype || 'lot'}`).slice(0, 60);

  // Layer 1: demand proximity
  let dAnchor = Infinity;
  let nearest = '';
  for (const a of config.anchor_locations) {
    const d = haversineMi(lat, lng, a.lat, a.lng);
    if (d < dAnchor) {
      dAnchor = d;
      nearest = a.name;
    }
  }

  let prox: number;
  for (const band of config.proximity_bands) {
    if (dAnchor < band.maxMi) {
      prox = band.score;
      break;
    }
  }
  prox ??= 10;

  // Depot bonus
  let depotBonus = 0;
  let distance_to_depot_miles: number | null = null;
  if (config.depot_location) {
    const dDepot = haversineMi(lat, lng, config.depot_location.lat, config.depot_location.lng);
    depotBonus = Math.min(15, dDepot * 2.5);
    distance_to_depot_miles = Math.round(dDepot * 100) / 100;
  }

  // Layer 3/4: geometry
  let geom: number;
  if (ptype === 'surface') geom = config.geometry_scores.surface;
  else if (ptype === 'multi-storey') geom = config.geometry_scores.multiStorey;
  else if (ptype === 'underground') geom = config.geometry_scores.underground;
  else geom = config.geometry_scores.untagged;

  // Layer 7: commercial signals
  let commercial: number;
  if (access === 'private' || access === 'customers') commercial = config.commercial_scores.ownerDirect;
  else if (tags.fee === 'yes') commercial = config.commercial_scores.paid;
  else commercial = config.commercial_scores.unknown;

  // Capacity fit
  const storageCap =
    cap_ !== null && cap_ >= config.capacity_thresholds.storage.min
      ? 100
      : cap_ !== null && cap_ >= 25
        ? 60
        : cap_ === null
          ? 75
          : 20;

  const stagingMin = config.capacity_thresholds.staging.min;
  const stagingMax = config.capacity_thresholds.staging.max;
  const stagingCap =
    cap_ !== null && cap_ >= stagingMin && cap_ <= stagingMax ? 100 : cap_ === null ? 80 : 60;

  // Apply weights
  const w = config.storage_weights;
  const storage = Math.round(
    w.proximity * prox +
      w.geometry * geom +
      w.capacity * storageCap +
      w.commercial * commercial +
      (w.depot ?? 0) * ((depotBonus / 15) * 100),
  );

  const ws = config.staging_weights;
  const staging = Math.round(
    ws.proximity * prox + ws.geometry * geom + ws.capacity * stagingCap + ws.commercial * commercial,
  );

  // Residential penalty
  const distance_to_res_meters = isNearResidential(lat, lng, residentialWays, config.residential_buffer_meters)
    ? 0
    : 500;
  let resFlag = '';
  if (distance_to_res_meters === 0) {
    resFlag = 'ADJACENT (<100m)';
  }

  let finalStorage = storage;
  let finalStaging = staging;
  if (resFlag.startsWith('ADJACENT')) {
    finalStorage = Math.max(0, storage - config.residential_penalty_points);
    finalStaging = Math.max(0, staging - config.residential_penalty_points);
  }

  // Capacity estimation from geometry
  const area = polygonAreaSqm(el.geometry ?? []);
  let capacity_source = cap_ !== null ? 'osm tag' : '';
  let estimatedCap: number | null = null;
  if (cap_ === null && area && area > 200) {
    const levels = tags.parking_levels || tags.building_levels || '1';
    let lv = 1;
    try {
      lv = Math.max(1, Math.min(Number.parseInt(levels, 10), 8));
    } catch {
      lv = 1;
    }
    estimatedCap = Math.round((area / 30) * lv);
    capacity_source = `estimated from ${Math.round(area).toLocaleString()} sqm`;
  }

  return {
    osm_id: `${el.type}/${el.id}`,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    name,
    type: ptype || 'unknown',
    capacity: cap_ ?? estimatedCap,
    capacity_source,
    area_sqm: area ? Math.round(area) : null,
    storage_score: finalStorage,
    staging_score: finalStaging,
    nearest_anchor_name: nearest,
    distance_to_anchor_miles: Math.round(dAnchor * 100) / 100,
    residential_flag: resFlag,
    distance_to_res_meters: distance_to_res_meters > 500 ? null : distance_to_res_meters,
    is_owner_direct_candidate: access === 'private' || access === 'customers',
    access: access || 'unknown',
    fee: tags.fee ?? '',
    distance_to_depot_miles,
    is_walk_list_ready: Math.max(finalStorage, finalStaging) >= config.walk_list_min_score,
    opening_hours: tags.opening_hours ?? null,
  };
}

export async function runFinder(_metro: MetroCode, config: FinderConfig): Promise<ScoredSite[]> {
  const { parking, residential } = await fetchOverpassData(config);
  const residentialWays = buildResidentialWays(residential);

  const sites = parking
    .map((el) => scoreSite(el, config, residentialWays))
    .filter((s): s is ScoredSite => s !== null);

  sites.sort(
    (a, b) => Math.max(b.storage_score, b.staging_score) - Math.max(a.storage_score, a.staging_score),
  );

  return sites;
}
