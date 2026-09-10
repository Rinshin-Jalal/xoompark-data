// Pure parse/map logic for the Secure Parking HI adapter — deliberately
// network- and Firestore-free (same split as spotheroParse.ts) so it runs
// under plain `node --experimental-strip-types`, no 'server-only' guard.
import type { SourcedLocationInput } from './types.ts';

export interface SecurehiLocation {
  url: string;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

/** Pull every location URL out of the parking_location-sitemap.xml. */
export function extractSecurehiLocationUrls(sitemapXml: string): string[] {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull name/address/lat-lng out of one location CPT page. Name is the <h1>;
 * address is the <p> with <br> lines (the leading "Secure Parking …" operator
 * line is dropped); lat/lng come from the #locationmap div's data_lat/data_lng.
 * Verified against a real fetch of /parking-location/hawaii-office/ on
 * 2026-08-25.
 */
export function extractSecurehiLocation(html: string, url: string): SecurehiLocation {
  const name = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const lat = html.match(/data_lat="([^"]+)"/)?.[1];
  const lng = html.match(/data_lng="([^"]+)"/)?.[1];

  let address: string | undefined;
  for (const p of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    if (!p[1].includes('<br') || !/\d{5}/.test(p[1])) continue;
    const lines = p[1]
      .replace(/<[^>]+>/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/secure parking/i.test(l));
    address = lines.join(', ');
    break;
  }

  return {
    url,
    name,
    address,
    lat: lat !== undefined && Number.isFinite(Number(lat)) ? Number(lat) : undefined,
    lng: lng !== undefined && Number.isFinite(Number(lng)) ? Number(lng) : undefined,
  };
}

/**
 * Map one Secure HI location to the store's input shape. sourceUrl is the
 * location's own CPT page; sourceListingId is its URL slug.
 */
export function mapSecurehiLocationToInput(location: SecurehiLocation): SourcedLocationInput | null {
  if (!location.name || !location.url) return null;

  const slug = location.url.replace(/\/+$/, '').split('/').filter(Boolean).pop();

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (location.address) fieldProvenance.address = 'self-reported';
  if (location.lat !== undefined) fieldProvenance.lat = 'self-reported';
  if (location.lng !== undefined) fieldProvenance.lng = 'self-reported';

  return {
    name: location.name,
    address: location.address,
    lat: location.lat,
    lng: location.lng,
    source: 'secure-parking-hi',
    sourceUrl: location.url,
    sourceListingId: slug,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: location,
  };
}

export interface SecurehiIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-fetched locations — same split as ingestFeaturedSpots. */
export async function ingestSecurehiLocations(
  locations: SecurehiLocation[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<SecurehiIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < locations.length; i += CONCURRENCY) {
    const chunk = locations.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((location) => {
        const input = mapSecurehiLocationToInput(location);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((location, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${location.name ?? location.url ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}