// Pure parse/map logic for the Gacha's Parking adapter — deliberately
// network- and Firestore-free (same split as spotheroParse.ts) so it runs
// under plain `node --experimental-strip-types`, no 'server-only' guard.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface GachasLocation {
  name: string;
  address: string;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull each location out of the #locations section. Each is a
 * <p>STREET,<br />CITY, STATE ZIP</p> block — the address doubles as the name
 * (the page has no facility name, only the street address). Verified against
 * a real fetch of gachasparking.com on 2026-08-25: 2 locations.
 */
export function extractGachasLocations(html: string): GachasLocation[] {
  const locations: GachasLocation[] = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    if (!m[1].includes('<br')) continue;
    const text = stripTags(m[1]);
    if (!/\d{5}/.test(text)) continue;
    locations.push({ name: text, address: text });
  }
  return locations;
}

/**
 * Map one Gacha's location to the store's input shape. No per-facility detail
 * page, so sourceUrl is `<page-url>#<slugified-name>` and the same slug
 * doubles as sourceListingId.
 */
export function mapGachasLocationToInput(location: GachasLocation, pageUrl: string): SourcedLocationInput | null {
  if (!location.name) return null;

  const slug = slugifyCity(location.name);
  const sourceUrl = `${pageUrl}#${slug}`;

  return {
    name: location.name,
    address: location.address,
    source: 'gachas',
    sourceUrl,
    sourceListingId: slug,
    capturedBy: 'scraped',
    fieldProvenance: { name: 'self-reported', address: 'self-reported' },
    rawInput: location,
  };
}

export interface GachasIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed locations — same split as ingestFeaturedSpots. */
export async function ingestGachasLocations(
  pageUrl: string,
  locations: GachasLocation[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<GachasIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < locations.length; i += CONCURRENCY) {
    const chunk = locations.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((location) => {
        const input = mapGachasLocationToInput(location, pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((location, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${location.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}