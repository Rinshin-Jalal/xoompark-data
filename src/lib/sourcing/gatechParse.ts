// Pure parse/map logic for the Georgia Tech parking adapter — deliberately
// network- and Firestore-free (same split as spotheroParse.ts) so it runs
// under plain `node --experimental-strip-types`, no 'server-only' guard.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface GatechFacility {
  name: string;
  priceText?: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format a "Hours and Pricing" table: header row is time ranges (first cell
 * empty), data rows are "day | rate | rate | rate". Produces
 * "day: time rate; time rate; ..." per row.
 */
function formatRateTable(tableHtml: string): string | undefined {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (rows.length < 2) return undefined;

  const headerCells = [...rows[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
  const times = headerCells.slice(1); // drop the empty leading cell

  const parts: string[] = [];
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 2) continue;
    const day = cells[0];
    const rates = cells.slice(1);
    const dayParts = rates.map((r, i) => `${times[i] ?? ''} ${r}`.trim()).filter(Boolean);
    if (dayParts.length) parts.push(`${day}: ${dayParts.join('; ')}`);
  }
  return parts.join(' | ') || undefined;
}

/**
 * Pull each facility out of the visitor-parking page. Each is a
 * <div class="wmd-heading">NAME</div> accordion item followed by a
 * "Hours and Pricing" table. Verified against a real fetch of
 * pts.gatech.edu/parking/visitor-parking/ on 2026-08-25: ~30 facilities.
 */
export function extractGatechFacilities(html: string): GatechFacility[] {
  const facilities: GatechFacility[] = [];
  const headingRe = /<div[^>]*class="wmd-heading"[^>]*>([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(headingRe)) {
    const name = stripTags(m[1]);
    if (!name) continue;

    const after = html.slice((m.index ?? 0) + m[0].length);
    const hpIdx = after.indexOf('Hours and Pricing');
    let priceText: string | undefined;
    if (hpIdx !== -1) {
      const tableStart = after.indexOf('<table', hpIdx);
      const tableEnd = after.indexOf('</table>', tableStart);
      if (tableStart !== -1 && tableEnd !== -1) {
        priceText = formatRateTable(after.slice(tableStart, tableEnd));
      }
    }
    facilities.push({ name, priceText });
  }
  return facilities;
}

/**
 * Map one Georgia Tech facility to the store's input shape. No per-facility
 * detail page, so sourceUrl is `<page-url>#<slugified-name>` and the same
 * slug doubles as sourceListingId.
 */
export function mapGatechFacilityToInput(facility: GatechFacility, pageUrl: string): SourcedLocationInput | null {
  if (!facility.name) return null;

  const slug = slugifyCity(facility.name);
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (facility.priceText) fieldProvenance.priceText = 'self-reported';

  return {
    name: facility.name,
    source: 'georgia-tech',
    sourceUrl,
    sourceListingId: slug,
    priceText: facility.priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: facility,
  };
}

export interface GatechIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed facilities — same split as ingestFeaturedSpots. */
export async function ingestGatechFacilities(
  pageUrl: string,
  facilities: GatechFacility[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<GatechIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < facilities.length; i += CONCURRENCY) {
    const chunk = facilities.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((facility) => {
        const input = mapGatechFacilityToInput(facility, pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((facility, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${facility.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}