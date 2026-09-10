// Pure parse/map logic for the SpotHero adapter — deliberately network- and
// Firestore-free (same split as types.ts vs store.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
import type { SourcedLocationInput } from './types.ts';

const NEXT_DATA_OPEN = '<script id="__NEXT_DATA__" type="application/json">';
const NEXT_DATA_CLOSE = '</script>';

/**
 * Pull the __NEXT_DATA__ JSON blob out of a SpotHero page's HTML via
 * string-slicing on the known script-tag boundaries (no HTML parser lib
 * needed for one known tag). Throws if the tag isn't found or isn't valid
 * JSON — caller is responsible for catching and recording the error.
 */
export function extractNextData(html: string): unknown {
  const start = html.indexOf(NEXT_DATA_OPEN);
  if (start === -1) throw new Error('extractNextData: __NEXT_DATA__ script tag not found');
  const jsonStart = start + NEXT_DATA_OPEN.length;
  const jsonEnd = html.indexOf(NEXT_DATA_CLOSE, jsonStart);
  if (jsonEnd === -1) throw new Error('extractNextData: unterminated __NEXT_DATA__ script tag');
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

// Shape of one entry in pageProps.featuredSpots on a SpotHero
// /destination/<city>/<slug> page. Only the fields we actually read —
// verified against a real fetch of downtown-miami-parking on 2026-08-23.
export interface SpotHeroFeaturedSpot {
  spotId?: string;
  title?: string;
  slug?: string;
  addresses?: Array<{
    streetAddress?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    latitude?: number;
    longitude?: number;
    types?: string[];
  }>;
  selectedRate?: {
    advertisedPrice?: { currencyCode?: string; value?: number };
    starts?: string;
    ends?: string;
  };
}

/** Reach into a parsed __NEXT_DATA__ object and return the featuredSpots array, or []. */
export function extractFeaturedSpots(nextData: unknown): SpotHeroFeaturedSpot[] {
  const data = nextData as { props?: { pageProps?: { featuredSpots?: unknown } } } | null;
  const spots = data?.props?.pageProps?.featuredSpots;
  return Array.isArray(spots) ? (spots as SpotHeroFeaturedSpot[]) : [];
}

function durationHours(starts?: string, ends?: string): number | null {
  if (!starts || !ends) return null;
  const ms = new Date(ends).getTime() - new Date(starts).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/** Raw "$X.XX" (+ duration window if known) — never a fabricated per-hour/per-day rate. */
function formatPriceText(spot: SpotHeroFeaturedSpot): string | undefined {
  const price = spot.selectedRate?.advertisedPrice;
  if (price?.value === undefined) return undefined;
  const amount = (price.value / 100).toFixed(2);
  const hours = durationHours(spot.selectedRate?.starts, spot.selectedRate?.ends);
  return hours ? `$${amount} (${hours}hr)` : `$${amount}`;
}

function pickAddress(spot: SpotHeroFeaturedSpot) {
  const addrs = spot.addresses ?? [];
  return addrs.find((a) => a.types?.includes('physical')) ?? addrs[0];
}

/**
 * Map one SpotHero featured-spot listing to the store's input shape.
 * Returns null when there's no listing id/slug to build a sourceUrl from —
 * caller must skip and count it, per Brad's sourceUrl-required rule.
 */
export function mapFeaturedSpotToInput(spot: SpotHeroFeaturedSpot): SourcedLocationInput | null {
  if (!spot.spotId || !spot.slug) return null;
  const sourceUrl = `https://spothero.com/facility/${spot.spotId}/${spot.slug}-parking`;

  const addr = pickAddress(spot);
  const address = addr?.streetAddress
    ? [addr.streetAddress, addr.city, [addr.state, addr.postalCode].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : undefined;

  const priceText = formatPriceText(spot);

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = {};
  for (const [field, present] of [
    ['name', !!spot.title],
    ['address', !!address],
    ['lat', addr?.latitude !== undefined],
    ['lng', addr?.longitude !== undefined],
    ['price_text', !!priceText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    name: spot.title ?? `SpotHero facility ${spot.spotId}`,
    address,
    lat: addr?.latitude,
    lng: addr?.longitude,
    source: 'spothero',
    sourceUrl,
    sourceListingId: spot.spotId,
    priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: spot,
  };
}

export interface SpotHeroPageIngestResult {
  url: string;
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core per-page sweep logic: map each spot to an input and hand it to the
 * injected upsert. Network- and Firestore-free itself (the upsert is
 * injected) — same split as extractFeaturedSpots/mapFeaturedSpotToInput, so
 * spothero.ts's real sweep just fetches+parses a page and calls this with
 * the real upsertSourcedLocation, and tests can pass an in-memory fake.
 */
export async function ingestFeaturedSpots(
  url: string,
  spots: SpotHeroFeaturedSpot[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<SpotHeroPageIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  // Chunked concurrency, same pattern as ingestParkopediaMiami — upsert is
  // a get+set round trip and a page can carry dozens of spots.
  const CONCURRENCY = 12;
  for (let i = 0; i < spots.length; i += CONCURRENCY) {
    const chunk = spots.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((spot) => {
        const input = mapFeaturedSpotToInput(spot);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((spot, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`spot ${spot.spotId ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { url, ingested, skipped, errors };
}
