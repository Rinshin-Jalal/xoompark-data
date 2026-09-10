// Pure parse/map logic for the iPark adapter — deliberately network- and
// Firestore-free (same split as spotheroParse.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard.
import type { SourcedLocationInput } from './types.ts';

export interface IparkGarage {
  name?: string;
  link?: string;
  slug?: string;
}

export interface IparkDetail {
  address?: string;
  hoursText?: string;
}

export interface IparkEntry {
  garage: IparkGarage;
  detail: IparkDetail;
}

/**
 * Pull name/link/slug out of the wp-json/wp/v2/garage list response. The
 * list carries no address/hours (acf and content are empty server-side) —
 * those come from each garage's detail page (see extractIparkDetail).
 * Verified against a real fetch on 2026-08-25: 161 garages across 2 pages.
 */
export function extractIparkGarages(json: unknown): IparkGarage[] {
  if (!Array.isArray(json)) return [];
  const garages: IparkGarage[] = [];
  for (const g of json as Array<Record<string, unknown>>) {
    const title = (g?.title as { rendered?: string } | undefined)?.rendered;
    const link = typeof g?.link === 'string' ? g.link : undefined;
    const slug = typeof g?.slug === 'string' ? g.slug : undefined;
    if (title && link) garages.push({ name: title, link, slug });
  }
  return garages;
}

/**
 * Pull address + hours out of a garage detail page's .info-line divs
 * ("Address: …" and "Hours: …"). Verified 2026-08-25.
 *
 * The label sits inside its own <span>, and the value follows straight
 * after the closing </span> (no whitespace) — e.g.
 * `<span>Address:</span>408 West 57th Street, NY, NY 10019`. Matching
 * past the </span> is required; a bare `Address:\s*([^<]+)` never matches
 * because the very next character is the `<` of `</span>` itself
 * (confirmed against a live fetch of ipark.com/garage/408-west-57th-parking-corp/).
 */
export function extractIparkDetail(html: string): IparkDetail {
  const addressMatch = html.match(/Address:<\/span>\s*([^<]+)/);
  const hoursMatch = html.match(/Hours:<\/span>\s*([^<]+)/);
  return {
    address: addressMatch?.[1]?.trim(),
    hoursText: hoursMatch?.[1]?.trim(),
  };
}

/**
 * Map one iPark garage (+ its detail-page address/hours) to the store's input
 * shape. sourceUrl is the garage's own detail page, sourceListingId its slug.
 */
export function mapIparkGarageToInput(entry: IparkEntry): SourcedLocationInput | null {
  const { garage, detail } = entry;
  if (!garage.name || !garage.link) return null;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (detail.address) fieldProvenance.address = 'self-reported';
  if (detail.hoursText) fieldProvenance.hoursText = 'self-reported';

  return {
    name: garage.name,
    address: detail.address,
    source: 'ipark',
    sourceUrl: garage.link,
    sourceListingId: garage.slug,
    hoursText: detail.hoursText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: entry,
  };
}

export interface IparkIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-fetched entries — same split as ingestFeaturedSpots. */
export async function ingestIparkGarages(
  entries: IparkEntry[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<IparkIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const chunk = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((entry) => {
        const input = mapIparkGarageToInput(entry);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((entry, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${entry.garage.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}