import { getAdminFirestore, getDefaultFirestore } from './firebaseAdmin';
import { parseClearanceInches } from './clearance';
import { formatHoursText } from './hours';
import type { ResourceTag, ServiceTag, SourcedParkingLocation } from './sourcing/types';
import { MIAMI_DEMAND_ZONES } from './sourcing/demandZones';
import type { Site, Resource, Offering, ServiceType, ResourceType, OfferingRate } from './types';
// Client-safe constants module — importing from app components is fine
// here (server-side), and keeps one source of truth for the demo site.
import { DEMO_DOC_ID } from '@/app/search/_components/locked';

// sourcing tags (lowercase) -> public /search enums. Not a plain uppercase:
// 'staging' maps to STAGE, not STAGING.
const SERVICE_TAG_TO_PUBLIC: Record<ServiceTag, ServiceType> = {
  staging: 'STAGE',
  charging: 'CHARGE',
  pudo: 'PUDO',
  wash: 'WASH',
  service: 'SERVICE',
};
const RESOURCE_TAG_TO_PUBLIC: Record<ResourceTag, ResourceType> = {
  parking_stall: 'PARKING_STALL',
  ev_connector: 'EV_CONNECTOR',
  curb_berth: 'CURB_BERTH',
  wash_bay: 'WASH_BAY',
  service_bay: 'SERVICE_BAY',
};

export interface PublicOffering {
  id: string;
  serviceType: ServiceType;
  meteringType: Offering['meteringType'];
  title: string;
  description: string;
  bookable: boolean;
  rate: OfferingRate;
}

export interface PublicResource {
  id: string;
  resourceType: ResourceType;
  capacity: number;
  offerings: PublicOffering[];
}

export interface PublicSite {
  id: string;
  city: string;
  /** Deterministic per-city area label ("NW-04") — sourcing sites only,
   *  since their names are hidden; distinguishes same-city cards. */
  label?: string;
  lat: number;
  lng: number;
  radiusM: number;
  resources: PublicResource[];
  serviceTypes: ServiceType[];
  resourceTypes: ResourceType[];

  /** Present only on parking-sourcing sites (no provider offerings yet). */
  source?: 'sourcing';
  /** Integer inches parsed from clearanceText; undefined = unverified. */
  clearanceInches?: number;
  /** stallsTotal when present, else capacityText parsed ("2,000 spaces" -> 2000). */
  stallsTotal?: number | null;
  /** Raw access-hours text from the listing ("Mon-Sun 6am-11pm"). */
  hoursText?: string;
  /** Raw rate text from the listing ("$10/2 hours") — sourcing sites only. */
  priceText?: string;
  /** Lot's real name — projected ONLY for the demo site (the full-data
   * proof); every other site keeps its name hidden (area code instead). */
  name?: string;
  /** 'surface' (lot) or 'structured' (garage) — sourcing sites only. */
  surfaceType?: 'surface' | 'structured';
  /** Gate mechanism — sourcing sites only. */
  gateType?: 'manual' | 'automatic' | 'gateless' | 'lpr';
  /** Ingress/egress description ("separate one-way") — sourcing sites only. */
  ingressEgress?: string;
  /** FEMA flood zone letter, null = checked & clean — sourcing sites only. */
  floodZone?: string | null;
  /** Nearest demand anchor name ("Brickell") — sourcing sites only. Straight-line
   *  distance, not driving; rounded at presentation, full precision in the doc. */
  nearestDemandZone?: string;
  /** Straight-line miles to the nearest demand anchor — sourcing sites only. */
  nearestDemandMi?: number;
  /** EV charging context (AFDC/NLR cross-reference) — sourcing sites only. */
  evContext?: {
    onSiteDcFastPorts?: number | null;
    nearestDcFastMi?: number | null;
    nearestNetwork?: string | null;
  };
  access247?: boolean | null;
  fenced?: boolean | null;
  lit?: boolean | null;
}

// Matches a trailing "TX" or "CA 94105" state segment (with or without zip),
// with or without a following ", USA" - both forms show up in our real
// address data. The city is the segment immediately before it.
const STATE_SEGMENT = /^\s*[A-Z]{2}(\s+\d{5})?\s*$/;

// Spelled-out state names that show up in place of the city segment on some
// scraped addresses ("..., Florida, FL") - never a valid city.
const STATE_NAMES = new Set([
  'FLORIDA', 'CALIFORNIA', 'TEXAS', 'ARIZONA', 'NEW YORK', 'GEORGIA',
  'WASHINGTON', 'ILLINOIS', 'COLORADO', 'NEVADA', 'LOUISIANA', 'OHIO',
]);

// Street-type suffix ("...79th Ave Doral") - when the pre-state segment
// carries a street number, the city is whatever follows the LAST
// street-type word. Greedy .* ensures the last match wins ("1st Court").
const STREET_TYPE_SPLIT =
  /^.*\b(?:ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|ter|terrace|pl|place|pkwy|parkway|hwy|highway|trl|trail|cir|circle|loop)\b\.?\s+(.+)$/i;

export function deriveCityFromAddress(address: string): string | null {
  const parts = address.split(',').map((p) => p.trim());
  const stateIndex = parts.findIndex((p) => STATE_SEGMENT.test(p));
  if (stateIndex < 1) return null;
  let city = parts[stateIndex - 1];
  // Scraped addresses often merge street and city in one comma segment
  // ("3929 NW 79th Ave Doral") - split after the street type; if that
  // fails, a digit-bearing segment is a street address, not a city.
  if (/\d/.test(city)) {
    const m = city.match(STREET_TYPE_SPLIT);
    city = m ? m[1] : '';
  }
  if (!city || /\d/.test(city) || STATE_NAMES.has(city.toUpperCase())) return null;
  return city;
}

export { slugifyCity } from './citySlug';

const EARTH_RADIUS_M = 6371000;

// Deterministic per-site offset so the same site always renders at the same
// public pin (stable across page loads) without needing a stored field or a
// write on every read. Bearing and distance are derived from a hash of the
// site id, distance uniformly sampled in [300, 400]m (~3-4 city blocks) - a
// real random band with an enforced minimum, not a fixed/ignored radius.
export function fuzzLocation(siteId: string, lat: number, lng: number): { lat: number; lng: number; radiusM: number } {
  let hash = 0;
  for (let i = 0; i < siteId.length; i++) {
    hash = (hash * 31 + siteId.charCodeAt(i)) >>> 0;
  }
  const bearing = (hash % 3600) / 10; // 0-360, one decimal of resolution
  const distance = 300 + ((hash >>> 8) % 100); // 300-400m (~3-4 city blocks)
  // The display radius is drawn from the same band as the offset distance,
  // so the circle shown to the user honestly bounds where the real site
  // could be - never a fixed/decorative radius unrelated to the actual fuzz.
  const radiusM = distance;

  const angular = distance / EARTH_RADIUS_M;
  const bearingRad = (bearing * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angular) + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearingRad)
  );
  const newLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angular) * Math.cos(latRad),
      Math.cos(angular) - Math.sin(latRad) * Math.sin(newLatRad)
    );

  return { lat: (newLatRad * 180) / Math.PI, lng: (newLngRad * 180) / Math.PI, radiusM };
}

// Strict allowlist projections - build the public object field by field,
// never spread the private record and delete keys off it.
function toPublicOffering(offering: Offering): PublicOffering {
  return {
    id: offering.id,
    serviceType: offering.serviceType,
    meteringType: offering.meteringType,
    title: offering.title,
    description: offering.description,
    bookable: offering.bookable,
    rate: offering.rate,
  };
}

function toPublicResource(resource: Resource, offerings: Offering[]): PublicResource {
  return {
    id: resource.id,
    resourceType: resource.resourceType,
    capacity: resource.capacity,
    offerings: offerings.filter((o) => o.resourceId === resource.id).map(toPublicOffering),
  };
}

function toPublicSite(site: Site, resources: PublicResource[]): PublicSite | null {
  const city = deriveCityFromAddress(site.address);
  if (!city) return null;
  const { lat, lng, radiusM } = fuzzLocation(site.id, site.location.lat, site.location.lng);
  const serviceTypes = Array.from(new Set(resources.flatMap((r) => r.offerings.map((o) => o.serviceType))));
  const resourceTypes = Array.from(new Set(resources.map((r) => r.resourceType)));
  return { id: site.id, city, lat, lng, radiusM, resources, serviceTypes, resourceTypes };
}

// In-memory TTL cache. /search is force-dynamic (Admin SDK creds are
// runtime-only), so without this every request pays the full ~1500-doc
// read (~3s). The dataset changes at human speed — 5 minutes of staleness
// is invisible. ponytail: single-process cache; move to Firestore/CDN-level
// caching if this ever runs multi-instance at high traffic.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; sites: PublicSite[] } | null = null;

// Fetches and joins the full public network dataset in one pass - dataset is
// small (tens of sites today), so it's simpler and faster to load it all
// once server-side and filter/search client-side than to round-trip per
// filter change.
export async function getPublicNetworkSites(): Promise<PublicSite[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.sites;
  // Core platform collections (sites, resources, offerings) live in the
  // default DB; sourced parking locations live in the aggregated DB.
  const coreDb = getDefaultFirestore();
  const [sitesSnap, resourcesSnap, offeringsSnap, sourcedSites] = await Promise.all([
    coreDb.collection('sites').where('status', '==', 'ACTIVE').get(),
    coreDb.collection('resources').where('status', '==', 'ACTIVE').get(),
    coreDb.collection('offerings').where('status', '==', 'PUBLISHED').where('bookable', '==', true).get(),
    getSourcedPublicSites(),
  ]);

  // doc.id is the canonical identifier throughout this codebase - a
  // document's own `id` field isn't guaranteed to be set (older records
  // predate that convention), so it's merged in rather than trusted.
  const offerings = offeringsSnap.docs.map((d) => ({ ...(d.data() as Offering), id: d.id }));
  const resourcesBySite = new Map<string, Resource[]>();
  for (const doc of resourcesSnap.docs) {
    const resource = { ...(doc.data() as Resource), id: doc.id };
    const list = resourcesBySite.get(resource.siteId) ?? [];
    list.push(resource);
    resourcesBySite.set(resource.siteId, list);
  }

  const sites: PublicSite[] = [];
  for (const doc of sitesSnap.docs) {
    const site = { ...(doc.data() as Site), id: doc.id };
    const resources = (resourcesBySite.get(site.id) ?? []).map((r) => toPublicResource(r, offerings));
    const publicSite = toPublicSite(site, resources);
    if (publicSite) sites.push(publicSite);
  }

  sites.push(...sourcedSites);
  cache = { at: Date.now(), sites };
  return sites;
}

/** "750" / "1500 spots" / "2,000 spaces" -> stall count. */
function parseCapacityText(text?: string): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** hoursText ("Open 24/7", "24 hours") -> affirmative 24/7 flag. */
function hoursImply247(text?: string): boolean {
  if (!text) return false;
  return /24\s*\/\s*7|open\s+24|24\s*hours/i.test(text);
}

/**
 * Public projection of the parking-sourcing pipeline (parking_lots).
 * No status filter — 'draft'/'saved' is a BDR workflow state, not a
 * public-readiness gate, and the bulk of the inventory (~1500 docs) is draft.
 * Strict allowlist like toPublicSite: NO name, address, source, price, or raw
 * input — only approximate location (fuzzed) and the attributes an AV fleet
 * actually screens on. Docs without lat/lng or a derivable city can't be
 * placed on a map, so they're skipped.
 */
async function getSourcedPublicSites(): Promise<PublicSite[]> {
  const db = getAdminFirestore();
  const snap = await db.collection('parking_lots').get();

  // First pass: collect the mappable docs with their public projection.
  const entries: { city: string; site: PublicSite }[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as SourcedParkingLocation;
    // typeof check, not === undefined: scraped docs store missing coords as
    // null, and a null slips through an undefined check, poisons the map
    // centroid toward (0,0) and renders NaN circles.
    if (d.mergedInto || typeof d.lat !== 'number' || typeof d.lng !== 'number') continue;
    // Locality fallback: truncate "Little Havana / Shenandoah" style
    // neighborhood pairs to their primary name so the browse row reads as
    // places, not slash soup. Title-case fixes scraped all-lowercase cities
    // ("miami") that would otherwise group separately from "Miami".
    const rawCity = deriveCityFromAddress(d.address ?? '') ?? d.locality?.split(' / ')[0] ?? null;
    if (!rawCity) continue;
    const city = rawCity.replace(/\b\w/g, (c) => c.toUpperCase());
    const { lat, lng, radiusM } = fuzzLocation(doc.id, d.lat, d.lng);
    entries.push({
      city,
      site: {
        // Prefixed so sourcing ids can never collide with network site ids.
        id: `sourcing:${doc.id}`,
        city,
        lat,
        lng,
        radiusM,
        resources: [],
        // Derived tags (see sourcing/types.ts deriveServicesResources) —
        // absent stays absent: untagged lots simply never match a service
        // filter, they stay searchable otherwise.
        serviceTypes: (d.services ?? []).map((t) => SERVICE_TAG_TO_PUBLIC[t]),
        resourceTypes: (d.resources ?? []).map((t) => RESOURCE_TAG_TO_PUBLIC[t]),
        source: 'sourcing',
        clearanceInches: parseClearanceInches(d.clearanceText),
        // stallsTotal is barely populated (3 docs) — capacityText ("2,000
        // spaces", 360 docs) is where the real counts live.
        stallsTotal: d.stallsTotal ?? parseCapacityText(d.capacityText),
        // hoursText is either plain text or raw SpotHero JSON — format to
        // "Mon–Fri 7 AM–11 PM"; undefined when nothing readable.
        hoursText: formatHoursText(d.hoursText),
        priceText: d.priceText ?? undefined,
        name: doc.id === DEMO_DOC_ID ? (d.name ?? undefined) : undefined,
        surfaceType: d.surfaceType ?? undefined,
        gateType: d.gateType ?? undefined,
        ingressEgress: d.ingressEgress ?? undefined,
        floodZone: d.geoContext?.floodZone ?? undefined,
        // Nearest demand anchor (name resolved from the zone id — the doc
        // stores only the id). Absent when the demand enrichment hasn't run.
        nearestDemandZone: d.geoContext?.demand
          ? MIAMI_DEMAND_ZONES.find((z) => z.id === d.geoContext!.demand!.nearestZoneId)?.name ?? d.geoContext.demand.nearestZoneId
          : undefined,
        nearestDemandMi: d.geoContext?.demand?.nearestDistanceMi ?? undefined,
        evContext: d.evContext ?? undefined,
        // access247 is affirmative-only; hoursText ("Open 24/7") is the
        // populated signal (1048 docs) — never override an explicit false.
        access247: d.access247 ?? (hoursImply247(d.hoursText) ? true : undefined),
        fenced: d.fenced ?? undefined,
        lit: d.lit ?? undefined,
      },
    });
  }

  // Second pass: without names, every card in a city would share the same
  // title. Give each a deterministic compass-quadrant label ("NW-04")
  // derived from the FUZZED location relative to the city centroid —
  // coarser than the blur, so it leaks nothing, but cards are tell-apart.
  const sums = new Map<string, { lat: number; lng: number; n: number }>();
  for (const { city, site } of entries) {
    const s = sums.get(city) ?? { lat: 0, lng: 0, n: 0 };
    s.lat += site.lat;
    s.lng += site.lng;
    s.n += 1;
    sums.set(city, s);
  }
  const quadrantCounters = new Map<string, number>();
  for (const { city, site } of entries) {
    const s = sums.get(city)!;
    const ns = site.lat >= s.lat / s.n ? 'N' : 'S';
    const ew = site.lng >= s.lng / s.n ? 'E' : 'W';
    const key = `${city}|${ns}${ew}`;
    const n = (quadrantCounters.get(key) ?? 0) + 1;
    quadrantCounters.set(key, n);
    site.label = `${ns}${ew}-${String(n).padStart(2, '0')}`;
  }
  return entries.map((e) => e.site);
}
