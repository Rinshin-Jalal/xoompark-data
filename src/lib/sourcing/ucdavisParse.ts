// Pure parse/map logic for the UC Davis Health parking adapter — deliberately
// network- and Firestore-free (same split as spotheroParse.ts) so it runs
// under plain `node --experimental-strip-types`, no 'server-only' guard.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface UcdavisFacility {
  name: string;
  priceText?: string;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pull each facility rate table off the visitor-parking page. Each <table>'s
 * first row names the facility (one or two cells — "Lot 8 Parking Rate" |
 * "Lot 11 Parking Rate" share a table), and the body's <p> text is the rate.
 * The trailing " Rate" / " Parking Rate" label suffix is stripped from the
 * name. Verified against a real fetch of health.ucdavis.edu/parking/visitor/
 * on 2026-08-25: 3 tables (Parking Structure 3, Lot 8 + Lot 11, Parking
 * Structure 2).
 */
export function extractUcdavisFacilities(html: string): UcdavisFacility[] {
  const facilities: UcdavisFacility[] = [];
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  for (const tableMatch of html.match(tableRe) ?? []) {
    const rows = [...tableMatch.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    if (rows.length === 0) continue;
    const headerCells = [...rows[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    const names = headerCells.map((n) => n.replace(/\s*(Parking\s+)?Rate\s*$/i, '').trim()).filter(Boolean);
    if (names.length === 0) continue;
    const body = rows.slice(1).join('');
    const rateTexts = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
    const priceText = rateTexts.join('; ') || undefined;
    for (const name of names) facilities.push({ name, priceText });
  }
  return facilities;
}

/**
 * Map one UC Davis facility to the store's input shape. No per-facility
 * detail page, so sourceUrl is `<page-url>#<slugified-name>` and the same
 * slug doubles as sourceListingId.
 */
export function mapUcdavisFacilityToInput(facility: UcdavisFacility, pageUrl: string): SourcedLocationInput | null {
  if (!facility.name) return null;

  const slug = slugifyCity(facility.name);
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (facility.priceText) fieldProvenance.priceText = 'self-reported';

  return {
    name: facility.name,
    source: 'uc-davis-health',
    sourceUrl,
    sourceListingId: slug,
    priceText: facility.priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: facility,
  };
}

export interface UcdavisIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed facilities — same split as ingestFeaturedSpots. */
export async function ingestUcdavisFacilities(
  pageUrl: string,
  facilities: UcdavisFacility[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<UcdavisIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < facilities.length; i += CONCURRENCY) {
    const chunk = facilities.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((facility) => {
        const input = mapUcdavisFacilityToInput(facility, pageUrl);
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