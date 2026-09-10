// Pure parse/map logic for the ParkWhiz adapter — deliberately network- and
// Firestore-free (same split as spotheroParse.ts/parkopediaParse.ts/lazParse.ts)
// so it runs under plain `node --experimental-strip-types`, no 'server-only'
// guard tripping.
import type { SourcedLocationInput } from './types.ts';

// Shape of one entry in ParkWhiz's public /v4/quotes/ response. The quote
// embeds the full location object under _embedded['pw:location'], so a single
// quotes call carries name/address/entrance lat-lng AND a live price — no
// second /v4/locations/{id} call needed. Verified against a real fetch of
// api.parkwhiz.com/v4/quotes/?q=coordinates:25.7617,-80.1918 on 2026-08-25.
export interface ParkWhizQuote {
  location_id?: string;
  start_time?: string;
  end_time?: string;
  purchase_options?: Array<{
    price?: { USD?: string };
    start_time?: string;
    end_time?: string;
  }>;
  _embedded?: {
    'pw:location'?: ParkWhizLocation;
  };
}

export interface ParkWhizLocation {
  id?: string;
  name?: string;
  address1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  entrances?: Array<{ coordinates?: number[] }>;
}

function durationHours(starts?: string, ends?: string): number | null {
  if (!starts || !ends) return null;
  const ms = new Date(ends).getTime() - new Date(starts).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/** Raw "$X.XX" (+ duration window if known) — never a fabricated per-hour/per-day rate. */
function formatPriceText(quote: ParkWhizQuote): string | undefined {
  const opt = quote.purchase_options?.[0];
  const price = opt?.price?.USD;
  if (price === undefined) return undefined;
  const hours = durationHours(opt?.start_time, opt?.end_time);
  return hours ? `$${price} (${hours}hr)` : `$${price}`;
}

/**
 * Map one ParkWhiz quote to the store's input shape. Returns null when
 * there's no location id — caller must skip and count it, per Brad's
 * sourceUrl-required rule (same contract as SpotHero/Parkopedia/LAZ).
 */
export function mapQuoteToInput(quote: ParkWhizQuote): SourcedLocationInput | null {
  const loc = quote._embedded?.['pw:location'];
  const id = quote.location_id ?? loc?.id;
  if (id === undefined) return null;
  const sourceUrl = `https://www.parkwhiz.com/locations/${id}/`;

  const name = loc?.name;
  const address = loc?.address1
    ? [loc.address1, loc.city, [loc.state, loc.postal_code].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : undefined;

  // ParkWhiz entrance coordinates are [lat, lng] (unlike Parkopedia's
  // GeoJSON [lng, lat]) — verified against the API's own docs and a live
  // fetch: [25.7622, -80.1911] is lat/lng for a Brickell garage.
  const coords = loc?.entrances?.[0]?.coordinates;
  const lat = coords?.[0];
  const lng = coords?.[1];

  const priceText = formatPriceText(quote);

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = {};
  for (const [field, present] of [
    ['name', !!name],
    ['address', !!address],
    ['lat', lat !== undefined],
    ['lng', lng !== undefined],
    ['priceText', !!priceText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    name: name ?? `ParkWhiz facility ${id}`,
    address,
    lat,
    lng,
    source: 'parkwhiz',
    sourceUrl,
    sourceListingId: String(id),
    priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: quote,
  };
}

export interface ParkWhizIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core sweep logic over already-fetched quotes: dedup by location_id (a grid
 * sweep hits the same facility from multiple points), map each to an input,
 * and hand it to the injected upsert. Network- and Firestore-free itself —
 * same split as ingestFeaturedSpots/ingestLazFacilities, so parkwhiz.ts's
 * real ingest just fetches the grid and calls this with the real
 * upsertSourcedLocation, and tests can pass an in-memory fake.
 */
export async function ingestQuotes(
  quotes: ParkWhizQuote[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<ParkWhizIngestResult> {
  const seen = new Set<string>();
  const unique: ParkWhizQuote[] = [];
  for (const q of quotes) {
    const id = q.location_id ?? q._embedded?.['pw:location']?.id;
    if (id === undefined || seen.has(String(id))) continue;
    seen.add(String(id));
    unique.push(q);
  }

  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const chunk = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((q) => {
        const input = mapQuoteToInput(q);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((q, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`quote ${q.location_id ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}