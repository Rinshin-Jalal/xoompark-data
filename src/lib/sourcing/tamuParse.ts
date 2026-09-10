// Pure parse/map logic for the Texas A&M parking adapter — deliberately
// network- and Firestore-free (same split as spotheroParse.ts) so it runs
// under plain `node --experimental-strip-types`, no 'server-only' guard.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface TamuGarage {
  name?: string;
  clearanceText?: string;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pull each garage out of garages.aspx's table.table-striped (Location |
 * Clearance Levels). Verified against a real fetch of
 * transport.tamu.edu/Parking/garages.aspx on 2026-08-25: 7 garages.
 */
export function extractTamuGarages(html: string): TamuGarage[] {
  const garages: TamuGarage[] = [];
  const tableRe = /<table[^>]*class="[^"]*table-striped[^"]*"[^>]*>[\s\S]*?<\/table>/gi;
  for (const tableMatch of html.match(tableRe) ?? []) {
    for (const rowMatch of tableMatch.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
      if (cells.length < 2) continue;
      const [name, clearance] = cells;
      if (!name || name.toUpperCase() === 'LOCATION') continue;
      garages.push({ name, clearanceText: clearance || undefined });
    }
  }
  return garages;
}

/**
 * Pull the campus-wide visitor rate tiers out of visitor.aspx's
 * "Duration | Day Rate | Night Rate" table, formatted as
 * "Duration: $day day / $night night".
 */
export function extractTamuRateText(html: string): string | undefined {
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  for (const tableMatch of html.match(tableRe) ?? []) {
    if (!tableMatch.includes('Duration')) continue;
    const rows = [...tableMatch.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    const tiers: string[] = [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
      if (cells.length < 3) continue;
      const [duration, day, night] = cells;
      if (duration.toUpperCase() === 'DURATION') continue;
      tiers.push(`${duration}: ${day} day / ${night} night`);
    }
    return tiers.join('; ') || undefined;
  }
  return undefined;
}

/**
 * Map one TAMU garage (+ the shared campus-wide visitor rate text) to the
 * store's input shape. No per-facility detail page, so sourceUrl is
 * `<garages-page-url>#<slugified-name>` and the same slug doubles as
 * sourceListingId. Clearance level maps to clearanceText.
 */
export function mapTamuGarageToInput(
  garage: TamuGarage,
  rateText: string | undefined,
  pageUrl: string,
): SourcedLocationInput | null {
  if (!garage.name) return null;

  const slug = slugifyCity(garage.name);
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (garage.clearanceText) fieldProvenance.clearanceText = 'self-reported';
  if (rateText) fieldProvenance.priceText = 'self-reported';

  return {
    name: garage.name,
    source: 'texas-am',
    sourceUrl,
    sourceListingId: slug,
    clearanceText: garage.clearanceText,
    priceText: rateText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: garage,
  };
}

export interface TamuIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed garages — same split as ingestFeaturedSpots. */
export async function ingestTamuGarages(
  pageUrl: string,
  garages: TamuGarage[],
  rateText: string | undefined,
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<TamuIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < garages.length; i += CONCURRENCY) {
    const chunk = garages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((garage) => {
        const input = mapTamuGarageToInput(garage, rateText, pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((garage, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${garage.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}