// Pure parse/map logic for the Sylvan Parking adapter — deliberately network-
// and Firestore-free (same split as spotheroParse.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface SylvanRow {
  name?: string;
  address?: string;
  phone?: string;
}

/** Strip tags + the nbsp/zero-width-space chars this page actually uses. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u200b/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull every row out of every table.simple-table on the locations-rates page.
 * Columns are GARAGE | ADDRESS | PHONE NUMBER; the header row (name ===
 * "GARAGE") is skipped. Verified against a real fetch of
 * sylvanparking.com/locations-rates.html on 2026-08-25: 3 tables, no rate
 * column.
 */
export function extractSylvanRows(html: string): SylvanRow[] {
  const rows: SylvanRow[] = [];
  const tableRe = /<table[^>]*class="[^"]*simple-table[^"]*"[^>]*>[\s\S]*?<\/table>/gi;
  for (const tableMatch of html.match(tableRe) ?? []) {
    for (const rowMatch of tableMatch.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
      if (cells.length < 3) continue;
      const [name, address, phone] = cells;
      if (!name || name.toUpperCase() === 'GARAGE') continue;
      rows.push({ name, address: address || undefined, phone: phone || undefined });
    }
  }
  return rows;
}

/**
 * Map one Sylvan row to the store's input shape. No per-facility detail page,
 * so sourceUrl is `<page-url>#<slugified-name>` and the same slug doubles as
 * sourceListingId. Phone has no schema field — it stays in rawInput only.
 */
export function mapSylvanRowToInput(row: SylvanRow, pageUrl: string): SourcedLocationInput | null {
  if (!row.name) return null;

  const slug = slugifyCity(row.name);
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (row.address) fieldProvenance.address = 'self-reported';

  return {
    name: row.name,
    address: row.address,
    source: 'sylvan',
    sourceUrl,
    sourceListingId: slug,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: row,
  };
}

export interface SylvanIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed rows — same split as ingestFeaturedSpots. */
export async function ingestSylvanRows(
  pageUrl: string,
  rows: SylvanRow[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<SylvanIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((row) => {
        const input = mapSylvanRowToInput(row, pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((row, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${row.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}