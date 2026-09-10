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

export function polygonAreaSqm(points: Array<{ lat: number; lon: number }>): number | null {
  if (!points || points.length < 3) return null;

  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p.lon * 111320.0 * k);
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
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export async function fetchOverpassData(config: FinderConfig): Promise<{
  parking: OverpassElement[];
  residential: OverpassElement[];
}> {
  const { bbox } = config;
  const s = bbox.south, w = bbox.west, n = bbox.north, e = bbox.east;

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
  points: Array<{ lat: number; lon: number }>;
}

export function buildResidentialWays(residential: OverpassElement[]): ResidentialWay[] {
  const ways: ResidentialWay[] = [];
  for (const el of residential) {
    const points = el.geometry;
    if (!points || points.length < 3) continue;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    }
    ways.push({ minLat, maxLat, minLon, maxLon, points });
  }
  return ways;
}

function projectMeters(
  centerLat: number,
  centerLon: number,
  lat: number,
  lon: number,
): { x: number; y: number } {
  const metersPerDegreeLat = 110540;
  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  return {
    x: (lon - centerLon) * metersPerDegreeLon,
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
  lon: number,
  ways: ResidentialWay[],
  bufferM: number,
): boolean {
  const pad = (bufferM * 1.5) / 111_000;
  for (const way of ways) {
    if (lat < way.minLat - pad || lat > way.maxLat + pad || lon < way.minLon - pad || lon > way.maxLon + pad) continue;
    const poly = way.points.map((p) => projectMeters(lat, lon, p.lat, p.lon));
    if (pointInPolygon(poly)) return true;
    for (let i = 0; i < poly.length - 1; i++) {
      if (distToSegmentMeters(poly[i], poly[i + 1]) <= bufferM) return true;
    }
  }
  return false;
}

// ===== Scoring =====

export interface ScoredSite {
  osmId: string;
  lat: number;
  lon: number;
  name: string;
  type: string;
  capacity: number | null;
  capacitySource: string;
  areaSqm: number | null;
  storageScore: number;
  stagingScore: number;
  nearestAnchor: string;
  anchorMi: number;
  residentialFlag: string;
  resDistanceM: number | null;
  ownerDirectCandidate: boolean;
  access: string;
  fee: string;
  depotMi: number | null;
  walkList: boolean;
  openingHours: string | null;
}

export function scoreSite(
  el: OverpassElement,
  config: FinderConfig,
  residentialWays: ResidentialWay[],
): ScoredSite | null {
  const tags = el.tags ?? {};
  let lat = el.lat ?? el.center?.lat;
  let lon = el.lon ?? el.center?.lon;
  // Ways/relations fetched with `out body geom` carry no lat/center — only a
  // geometry ring. Fall back to its centroid (matches the original finder.py).
  if (lat === undefined && el.geometry && el.geometry.length > 0) {
    lat = el.geometry.reduce((sum, p) => sum + p.lat, 0) / el.geometry.length;
    lon = el.geometry.reduce((sum, p) => sum + p.lon, 0) / el.geometry.length;
  }
  if (lat === undefined || lon === undefined) return null;

  const ptype = tags.parking ?? '';
  const capRaw = tags.capacity;
  const cap = capRaw !== undefined ? Number.parseInt(capRaw, 10) : null;
  const cap_ = Number.isNaN(cap) ? null : cap;
  const access = tags.access ?? '';
  const name = (tags.name || tags.operator || `unnamed ${ptype || 'lot'}`).slice(0, 60);

  // Layer 1: demand proximity
  let dAnchor = Infinity;
  let nearest = '';
  for (const a of config.anchors) {
    const d = haversineMi(lat, lon, a.lat, a.lon);
    if (d < dAnchor) {
      dAnchor = d;
      nearest = a.name;
    }
  }

  let prox: number;
  for (const band of config.proximityBands) {
    if (dAnchor < band.maxMi) {
      prox = band.score;
      break;
    }
  }
  prox ??= 10;

  // Depot bonus
  let depotBonus = 0;
  let depotMi: number | null = null;
  if (config.referenceDepot) {
    const dDepot = haversineMi(lat, lon, config.referenceDepot.lat, config.referenceDepot.lon);
    depotBonus = Math.min(15, dDepot * 2.5);
    depotMi = Math.round(dDepot * 100) / 100;
  }

  // Layer 3/4: geometry
  let geom: number;
  if (ptype === 'surface') geom = config.geometryScores.surface;
  else if (ptype === 'multi-storey') geom = config.geometryScores.multiStorey;
  else if (ptype === 'underground') geom = config.geometryScores.underground;
  else geom = config.geometryScores.untagged;

  // Layer 7: commercial signals
  let commercial: number;
  if (access === 'private' || access === 'customers') commercial = config.commercialScores.ownerDirect;
  else if (tags.fee === 'yes') commercial = config.commercialScores.paid;
  else commercial = config.commercialScores.unknown;

  // Capacity fit
  const storageCap =
    cap_ !== null && cap_ >= config.capacityThresholds.storage.min
      ? 100
      : cap_ !== null && cap_ >= 25
        ? 60
        : cap_ === null
          ? 75
          : 20;

  const stagingMin = config.capacityThresholds.staging.min;
  const stagingMax = config.capacityThresholds.staging.max;
  const stagingCap =
    cap_ !== null && cap_ >= stagingMin && cap_ <= stagingMax ? 100 : cap_ === null ? 80 : 60;

  // Apply weights
  const w = config.storageWeights;
  const storage = Math.round(
    w.proximity * prox +
      w.geometry * geom +
      w.capacity * storageCap +
      w.commercial * commercial +
      (w.depot ?? 0) * ((depotBonus / 15) * 100),
  );

  const ws = config.stagingWeights;
  const staging = Math.round(
    ws.proximity * prox + ws.geometry * geom + ws.capacity * stagingCap + ws.commercial * commercial,
  );

  // Residential penalty
  const resDistanceM = isNearResidential(lat, lon, residentialWays, config.residentialBuffer)
    ? 0
    : 500;
  let resFlag = '';
  if (resDistanceM === 0) {
    resFlag = 'ADJACENT (<100m)';
  }

  let finalStorage = storage;
  let finalStaging = staging;
  if (resFlag.startsWith('ADJACENT')) {
    finalStorage = Math.max(0, storage - config.residentialPenalty);
    finalStaging = Math.max(0, staging - config.residentialPenalty);
  }

  // Capacity estimation from geometry
  const area = polygonAreaSqm(el.geometry ?? []);
  let capacitySource = cap_ !== null ? 'osm tag' : '';
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
    capacitySource = `estimated from ${Math.round(area).toLocaleString()} sqm`;
  }

  return {
    osmId: `${el.type}/${el.id}`,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    name,
    type: ptype || 'unknown',
    capacity: cap_ ?? estimatedCap,
    capacitySource,
    areaSqm: area ? Math.round(area) : null,
    storageScore: finalStorage,
    stagingScore: finalStaging,
    nearestAnchor: nearest,
    anchorMi: Math.round(dAnchor * 100) / 100,
    residentialFlag: resFlag,
    resDistanceM: resDistanceM > 500 ? null : resDistanceM,
    ownerDirectCandidate: access === 'private' || access === 'customers',
    access: access || 'unknown',
    fee: tags.fee ?? '',
    depotMi,
    walkList: Math.max(finalStorage, finalStaging) >= config.walkListThreshold,
    openingHours: tags.opening_hours ?? null,
  };
}

export async function runFinder(_metro: MetroCode, config: FinderConfig): Promise<ScoredSite[]> {
  const { parking, residential } = await fetchOverpassData(config);
  const residentialWays = buildResidentialWays(residential);

  const sites = parking
    .map((el) => scoreSite(el, config, residentialWays))
    .filter((s): s is ScoredSite => s !== null);

  sites.sort(
    (a, b) => Math.max(b.storageScore, b.stagingScore) - Math.max(a.storageScore, a.stagingScore),
  );

  return sites;
}
