// Pure parse/map logic for the Parkopedia adapter — deliberately network- and
// Firestore-free (same split as spotheroParse.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
import type { SourcedLocationInput, SourcedParkingLocation } from './types.ts';

const REACT_PROPS_OPEN = "data-react-props='";

/** The five entities actually observed in Parkopedia's react-props attribute. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Pull the `data-react-props` JSON blob out of a Parkopedia city page's
 * HTML via string-slicing on the known attribute boundary (single-quoted,
 * HTML-entity-encoded JSON — no HTML parser lib needed for one known attr).
 * Throws if the attribute isn't found or isn't valid JSON after decoding —
 * caller is responsible for catching and recording the error.
 */
export function extractReactProps(html: string): unknown {
  const start = html.indexOf(REACT_PROPS_OPEN);
  if (start === -1) throw new Error('extractReactProps: data-react-props attribute not found');
  const jsonStart = start + REACT_PROPS_OPEN.length;
  const jsonEnd = html.indexOf("'", jsonStart);
  if (jsonEnd === -1) throw new Error('extractReactProps: unterminated data-react-props attribute');
  return JSON.parse(decodeHtmlEntities(html.slice(jsonStart, jsonEnd)));
}

// Shape of one entry in props.locations.all on a Parkopedia
// /parking/<city_slug>/ page. Only the fields we actually read — verified
// against a real fetch of en.parkopedia.com/parking/miami_fl/ on 2026-08-23.
export interface ParkopediaLocation {
  id?: number;
  geometry?: {
    geometries?: Array<{ type?: string; coordinates?: number[] }>;
  };
  properties?: {
    dynamic?: {
      rates?: Array<{ price_text?: string }>;
    };
    static?: {
      name?: string;
      address?: string[];
      url?: string;
      times?: {
        open?: Array<{ day_text?: string; from?: string; to?: string }>;
      };
    };
  };
}

/** Reach into a parsed react-props object and return locations.all, or []. */
export function extractLocations(props: unknown): ParkopediaLocation[] {
  const data = props as { locations?: { all?: unknown } } | null;
  const all = data?.locations?.all;
  return Array.isArray(all) ? (all as ParkopediaLocation[]) : [];
}

/**
 * Reach into a parsed react-props object and return locations.active — the
 * single location a Parkopedia individual-location detail page (e.g.
 * /parking/garage/<slug>/<zip>/<city>/) is about, or null. Same Feature
 * shape as one entry in locations.all (verified 2026-08-25 by diffing a
 * fetched detail page's `active` against its own matching `all` entry —
 * identical `properties.static`/`properties.dynamic`, so no separate detail
 * parser exists — see the recon comment in sourceUrlFetch.ts).
 */
export function extractActiveLocation(props: unknown): ParkopediaLocation | null {
  const data = props as { locations?: { active?: unknown } } | null;
  const active = data?.locations?.active;
  return active && typeof active === 'object' ? (active as ParkopediaLocation) : null;
}

/** First Point geometry's [lng, lat] -> {lat, lng}, or {} if none. */
function pickLatLng(loc: ParkopediaLocation): { lat?: number; lng?: number } {
  const point = loc.geometry?.geometries?.find((g) => g.type === 'Point');
  const coords = point?.coordinates;
  if (!coords || coords.length < 2) return {};
  return { lng: coords[0], lat: coords[1] };
}

function formatClockTime(t?: string): string | undefined {
  if (!t || t.length !== 4) return t;
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

/** "Mon-Sun 00:00-24:00" style summary, raw day_text preserved. */
function formatHoursText(loc: ParkopediaLocation): string | undefined {
  const open = loc.properties?.static?.times?.open;
  if (!open || open.length === 0) return undefined;
  return open
    .map((o) => `${o.day_text ?? ''} ${formatClockTime(o.from)}-${formatClockTime(o.to)}`.trim())
    .join('; ');
}

/**
 * Map one Parkopedia location listing to the store's input shape. Returns
 * null when there's no source URL — caller must skip and count it, per
 * Brad's sourceUrl-required rule (same as SpotHero's spotId/slug check).
 */
export function mapLocationToInput(loc: ParkopediaLocation): SourcedLocationInput | null {
  const sourceUrl = loc.properties?.static?.url;
  if (!sourceUrl) return null;

  const name = loc.properties?.static?.name;
  const addressParts = loc.properties?.static?.address ?? [];
  const address = addressParts.filter(Boolean).join(', ') || undefined;
  const { lat, lng } = pickLatLng(loc);
  const priceText = loc.properties?.dynamic?.rates?.[0]?.price_text;
  const hoursText = formatHoursText(loc);

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = {};
  for (const [field, present] of [
    ['name', !!name],
    ['address', !!address],
    ['lat', lat !== undefined],
    ['lng', lng !== undefined],
    ['priceText', !!priceText],
    ['hoursText', !!hoursText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    name: name ?? `Parkopedia location ${loc.id ?? '?'}`,
    address,
    lat,
    lng,
    source: 'parkopedia',
    sourceUrl,
    sourceListingId: loc.id !== undefined ? String(loc.id) : undefined,
    priceText,
    hoursText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: loc,
  };
}

// --- Cross-source match probe (groundwork for a later merge feature) ---
// Pure comparison logic only — no Firestore reads here. The caller reads
// both sources' records (via listSourcedLocations) and passes them in.

export interface CrossSourceMatch {
  parkopediaId: string;
  spotheroId: string;
  addressSimilarity: number; // structured street/lot comparison, 0-1 (see addressSimilarity)
  distanceMeters: number;
}

/** Great-circle distance between two lat/lng points, in meters. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const DIRECTIONALS = new Set([
  'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw',
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest',
]);
const STREET_SUFFIXES = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive',
]);
const UNIT_STOP_WORDS = new Set(['lot', 'suite', 'ste']);

interface AddressParts {
  streetNumber?: string;
  streetName?: string;
  unitOrLotLabel?: string;
}

/** "lot 18" / "ste 4" / "#18" -> a normalized identity like "lot18", or undefined. */
function extractUnitOrLotLabel(lower: string): string | undefined {
  const wordMatch = lower.match(/\b(lot|suite|ste)\.?\s*#?\s*(\d+)\b/);
  if (wordMatch) {
    const type = wordMatch[1] === 'ste' ? 'suite' : wordMatch[1];
    return `${type}${wordMatch[2]}`;
  }
  const hashMatch = lower.match(/#\s*(\d+)/);
  return hashMatch ? `unit${hashMatch[1]}` : undefined;
}

const MAX_STREET_NAME_TOKENS = 4;

/**
 * Street number + name, anchored on the first street-suffix word rather than
 * string position — real records (esp. Parkopedia's joined address-parts
 * array) prefix the actual street address with an operator name and/or a
 * lot label, e.g. "miami parking authority municipal lot 18 1320 nw 12th st
 * allapattah miami", so the street number is rarely the first token.
 */
function findStreetSegment(tokens: string[]): { streetNumber?: string; streetName?: string } {
  const suffixIdx = tokens.findIndex((t) => STREET_SUFFIXES.has(t));
  if (suffixIdx === -1) return {};

  const nameTokens: string[] = [];
  let i = suffixIdx - 1;
  while (i >= 0 && nameTokens.length < MAX_STREET_NAME_TOKENS) {
    const tok = tokens[i];
    if (/^\d+$/.test(tok) || DIRECTIONALS.has(tok) || UNIT_STOP_WORDS.has(tok)) break;
    nameTokens.unshift(tok);
    i--;
  }
  if (i >= 0 && DIRECTIONALS.has(tokens[i])) i--;
  const streetNumber = i >= 0 && /^\d+$/.test(tokens[i]) ? tokens[i] : undefined;

  return { streetNumber, streetName: nameTokens.length ? nameTokens.join(' ') : undefined };
}

/** Street number, directional-and-suffix-stripped street name, and any lot/unit label. */
function parseAddressParts(raw: string): AddressParts {
  const lower = raw.toLowerCase();
  const unitOrLotLabel = extractUnitOrLotLabel(lower);
  const tokens = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return { ...findStreetSegment(tokens), unitOrLotLabel };
}

/** Jaccard similarity over whitespace-split tokens — weak fallback signal only. */
function tokenJaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) if (setB.has(tok)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Structured address comparison, 0-1. Same street number + street name is a
 * strong signal (1.0); a shared "lot 18" / "#18" style label is nearly as
 * strong (0.85) even with no street match at all — real listings pair a
 * full street address against a bare "Municipal Lot 18"; matching street
 * name alone (different or missing number) is weaker (0.6, not enough on
 * its own to cross classifyCrossSourceMatch's confident threshold); anything
 * else falls back to raw-token Jaccard as a weak signal.
 */
export function addressSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const partsA = parseAddressParts(a);
  const partsB = parseAddressParts(b);

  if (
    partsA.streetNumber &&
    partsA.streetName &&
    partsA.streetNumber === partsB.streetNumber &&
    partsA.streetName === partsB.streetName
  ) {
    return 1;
  }
  if (partsA.unitOrLotLabel && partsA.unitOrLotLabel === partsB.unitOrLotLabel) {
    return 0.85;
  }
  if (partsA.streetName && partsA.streetName === partsB.streetName) {
    return 0.6;
  }
  return tokenJaccard(a, b);
}

/**
 * Naive O(n*m) scan for likely parkopedia/spothero duplicates: pin
 * proximity under maxDistanceMeters (default 50) AND some address token
 * overlap. Report-only — never writes anything back to the store.
 * ponytail: O(n*m) scan, fine at hundreds of rows/city; add a geo grid
 * index if a metro's record count makes this slow.
 */
export function findCrossSourceMatches(
  parkopediaRecords: SourcedParkingLocation[],
  spotheroRecords: SourcedParkingLocation[],
  opts: { maxDistanceMeters?: number } = {},
): CrossSourceMatch[] {
  const maxDistance = opts.maxDistanceMeters ?? 50;
  const matches: CrossSourceMatch[] = [];
  for (const p of parkopediaRecords) {
    if (p.lat === undefined || p.lng === undefined) continue;
    for (const s of spotheroRecords) {
      if (s.lat === undefined || s.lng === undefined) continue;
      const distanceMeters = haversineMeters({ lat: p.lat, lng: p.lng }, { lat: s.lat, lng: s.lng });
      if (distanceMeters > maxDistance) continue;
      matches.push({
        parkopediaId: p.id,
        spotheroId: s.id,
        addressSimilarity: addressSimilarity(p.normalized_address ?? p.address, s.normalized_address ?? s.address),
        distanceMeters,
      });
    }
  }
  return matches;
}

export type CrossSourceVerdict = 'confident' | 'ambiguous';

/**
 * Classify one match per Brad's thresholds: tight address overlap AND a
 * close pin is a confident dupe candidate; a close pin with a weak address
 * match is only ambiguous — report-only, never auto-merged.
 */
export function classifyCrossSourceMatch(match: CrossSourceMatch): CrossSourceVerdict {
  // 0.75 sits strictly between the "street name only" tier (0.6, still
  // ambiguous — could be two different addresses on the same street) and
  // the "lot/unit label match" and "number+name match" tiers (0.85 / 1.0).
  return match.addressSimilarity >= 0.75 && match.distanceMeters < 50 ? 'confident' : 'ambiguous';
}
