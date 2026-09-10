// Pure parse/map logic for the LAZ Parking adapter — deliberately network-
// and Firestore-free (same split as spotheroParse.ts/parkopediaParse.ts) so
// it runs under plain `node --experimental-strip-types`, no 'server-only'
// guard tripping.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

// One LAZ facility detail page, already scraped to markdown via Firecrawl
// (see laz.ts). Unlike SpotHero/Parkopedia's one-page-many-listings shape,
// each LAZ facility is its own full page — verified against real fetches of
// lazparking.com/local/miami-fl/wynwood-garage and
// lazparking.com/local/miami-beach-fl/500-collins on 2026-08-24.
export interface LazFacilityPage {
  url: string;
  markdown: string;
}

export interface LazFacilityListing {
  url: string;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  hoursText?: string;
  priceText?: string;
}

/** First `# Heading` line -> facility name, or undefined. */
function extractName(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || undefined;
}

/**
 * The "## Address" section: street address, then city/state/zip each on
 * their own line, up to the "[Get Directions]" link. A second permit-mailing
 * address line — seen as both "Permit address:" (wynwood-garage) and the
 * abbreviated "Permit Add:" (plaza-57) across live Miami facilities — is a
 * separate address for permits, not the facility's own street address, and
 * is dropped regardless of which wording the page uses.
 */
function extractAddress(markdown: string): string | undefined {
  const start = markdown.indexOf('## Address');
  if (start === -1) return undefined;
  const end = markdown.indexOf('[Get Directions]', start);
  const block = markdown.slice(start + '## Address'.length, end === -1 ? undefined : end);

  const lines = block
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter(Boolean)
    .filter((l) => !/^permit\b/i.test(l));
  if (lines.length === 0) return undefined;

  const [street, city, ...stateZip] = lines;
  return [street, city, stateZip.join(' ')].filter(Boolean).join(', ');
}

/** The "[Get Directions](...daddr=LAT+LNG)" link's coordinates, or {}. */
function extractLatLng(markdown: string): { lat?: number; lng?: number } {
  const match = markdown.match(/daddr=(-?\d+\.?\d*)\+(-?\d+\.?\d*)/);
  if (!match) return {};
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {};
}

/**
 * The "## Hours of Operation" markdown table, flattened to text verbatim
 * (pipe/dash table syntax stripped, cell text kept as-is — no reformatting
 * into e.g. per-day open/close ranges).
 */
function extractHoursText(markdown: string): string | undefined {
  const marker = '## Hours of Operation';
  const start = markdown.indexOf(marker);
  if (start === -1) return undefined;
  const end = markdown.indexOf('## ', start + marker.length);
  const block = markdown.slice(start + marker.length, end === -1 ? undefined : end);

  const rows = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[|:\-\s]+$/.test(l))
    .map((l) =>
      l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean);

  return rows.length ? rows.join('; ') : undefined;
}

/**
 * Best-effort, defensive rate grab. Recon (2026-08-24): neither sampled
 * facility page (wynwood-garage, 500-collins) surfaces a rate in the static
 * markdown — LAZ's live pricing sits behind the dynamic "Buy Parking"
 * reservation flow, out of reach for a plain scrape. This exists for any
 * facility page that DOES show one (e.g. a "## Rates" section) — verbatim,
 * never reformatted — but expect it to stay undefined for most/all of this
 * Miami batch.
 */
function extractPriceText(markdown: string): string | undefined {
  const match = markdown.match(/\$\d[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:hr|hour|day|month))?/i);
  return match?.[0];
}

/** Parse one facility page's markdown into a structured listing. */
export function parseLazFacility(page: LazFacilityPage): LazFacilityListing {
  return {
    url: page.url,
    name: extractName(page.markdown),
    address: extractAddress(page.markdown),
    ...extractLatLng(page.markdown),
    hoursText: extractHoursText(page.markdown),
    priceText: extractPriceText(page.markdown),
  };
}

const URL_PATH_RE = /\/local\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i;

/**
 * LAZ's own city+facility URL-path segments as the listing id (e.g.
 * "miami-fl-wynwood-garage") — this is LAZ's own routing data, not
 * something invented here. Falls back to slugifyCity(name-address), the
 * same fallback shape as addLocation.ts's manual-entry slug (reusing the
 * one slugifier, not a second one), only when the URL doesn't match the
 * expected /local/<city>/<facility> shape.
 */
function deriveSourceListingId(url: string, name?: string, address?: string): string | undefined {
  const match = url.match(URL_PATH_RE);
  if (match) return `${match[1]}-${match[2]}`.toLowerCase();
  const slugBase = address ? `${name ?? ''}-${address}` : name;
  return slugBase ? slugifyCity(slugBase).slice(0, 80) : undefined;
}

/**
 * Map one parsed LAZ listing to the store's input shape. Returns null when
 * there's no discoverable page URL — caller must skip and count it, per
 * Brad's sourceUrl-required rule (same contract as SpotHero/Parkopedia).
 */
export function mapLazFacilityToInput(listing: LazFacilityListing): SourcedLocationInput | null {
  if (!listing.url) return null;

  const name = listing.name ?? `LAZ facility: ${listing.url}`;
  const sourceListingId = deriveSourceListingId(listing.url, listing.name, listing.address);

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = {};
  for (const [field, present] of [
    ['name', !!listing.name],
    ['address', !!listing.address],
    ['lat', listing.lat !== undefined],
    ['lng', listing.lng !== undefined],
    ['hoursText', !!listing.hoursText],
    ['priceText', !!listing.priceText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    name,
    address: listing.address,
    lat: listing.lat,
    lng: listing.lng,
    source: 'laz',
    sourceUrl: listing.url,
    sourceListingId,
    priceText: listing.priceText,
    hoursText: listing.hoursText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: listing,
  };
}

export interface LazIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core sweep logic over already-fetched facility pages: parse + map each
 * page and hand it to the injected upsert. Network- and Firestore-free
 * itself (the upsert is injected) — same split as SpotHero's
 * ingestFeaturedSpots / Parkopedia's core loop, so laz.ts's real ingest just
 * Firecrawl-fetches each URL and calls this with the real
 * upsertSourcedLocation, and tests can pass an in-memory fake.
 */
export async function ingestLazFacilities(
  pages: LazFacilityPage[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<LazIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 5;
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const chunk = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((page) => {
        const listing = parseLazFacility(page);
        const input = mapLazFacilityToInput(listing);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((page, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${page.url}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}
