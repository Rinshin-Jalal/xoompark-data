// Pure parse/map logic for the MIA Airport adapter — deliberately network- and
// Firestore-free (same split as types.ts vs store.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

/** The handful of entities actually seen on this page (&amp; &nbsp;). */
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

const GARAGE_TABLE_MARKER = 'Parking Location';

/**
 * Pull the garage-name column out of the "Parking Location / Accessible
 * Parking / Van Accessible Parking" table via string-slicing on its known
 * header text, then regex over just that table's rows for the first <td> of
 * each (no HTML parser lib). Verified against a real fetch of
 * miami-airport.com/airport-parking.asp on 2026-08-25: 6 rows (Dolphin,
 * Flamingo, Ibis, Park 1, High Vehicle, Economy Park & Ride garages). A
 * third table on the page (class="GarageTable") repeats a couple of these
 * names next to a live/JS-filled space-count column — deliberately not read
 * here, this only walks the static accessible-parking table.
 */
export function extractGarageNames(html: string): string[] {
  const markerIdx = html.indexOf(GARAGE_TABLE_MARKER);
  if (markerIdx === -1) return [];
  const tableStart = html.lastIndexOf('<table', markerIdx);
  const tableEnd = html.indexOf('</table>', markerIdx);
  if (tableStart === -1 || tableEnd === -1) return [];
  const tableHtml = html.slice(tableStart, tableEnd);

  const bodyStart = tableHtml.indexOf('<tbody>');
  const body = bodyStart === -1 ? tableHtml : tableHtml.slice(bodyStart);

  const names: string[] = [];
  for (const rowMatch of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cellMatch = rowMatch[1].match(/<td[^>]*>([\s\S]*?)<\/td>/);
    const name = cellMatch ? stripTags(cellMatch[1]) : '';
    if (name) names.push(name);
  }
  return names;
}

export interface MiaRateRow {
  label: string;
  amount: string;
}

const RATE_TABLE_MARKER = '<table class="table table-sm"';

/**
 * Pull the hourly-rate rows out of the "$X per 20-min increment / $Y max
 * daily" table (class="table table-sm", the one distinctively-classed table
 * on the page — verified 2026-08-25). This is one campus-wide rate, not
 * per-garage — the page carries no per-garage pricing — so it's applied as a
 * shared priceText on every garage row (see mapGarageToInput).
 */
export function extractRateRows(html: string): MiaRateRow[] {
  const tableStart = html.indexOf(RATE_TABLE_MARKER);
  if (tableStart === -1) return [];
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return [];
  const tableHtml = html.slice(tableStart, tableEnd);

  const rows: MiaRateRow[] = [];
  for (const rowMatch of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = rowMatch[1];
    const labelMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    const amountMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!labelMatch || !amountMatch) continue;
    const label = stripTags(labelMatch[1]);
    const amount = stripTags(amountMatch[1]);
    if (label && amount) rows.push({ label, amount });
  }
  return rows;
}

/** Raw label+amount pairs joined verbatim — never recomputed into a $/hr rate. */
export function formatRateText(rows: MiaRateRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  return rows.map((r) => `${r.label}: ${r.amount}`).join('; ');
}

/**
 * Map one garage name (+ the shared campus-wide rate text) to the store's
 * input shape. The page has no per-garage detail page, so sourceUrl is built
 * as `<page-url>#<slugified-name>` per the sourceUrl-required convention —
 * and the same slug doubles as sourceListingId since there's no address on
 * this page for the dedupe-by-address fallback to key off of. Returns null
 * only when there's no name at all.
 */
export function mapGarageToInput(
  name: string,
  priceText: string | undefined,
  pageUrl: string,
): SourcedLocationInput | null {
  if (!name) return null;
  const slug = slugifyCity(name);
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (priceText) fieldProvenance.priceText = 'self-reported';

  return {
    name,
    source: 'mia-airport',
    sourceUrl,
    sourceListingId: slug,
    priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: { name, priceText },
  };
}

export interface MiaIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core ingest logic: map each garage name to an input (sharing the one
 * campus-wide priceText) and hand it to the injected upsert. Network- and
 * Firestore-free itself (the upsert is injected) — same split as
 * ingestFeaturedSpots/ingestLazFacilities.
 */
export async function ingestMiaGarages(
  pageUrl: string,
  names: string[],
  priceText: string | undefined,
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<MiaIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < names.length; i += CONCURRENCY) {
    const chunk = names.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((name) => {
        const input = mapGarageToInput(name, priceText, pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((name, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${name || '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}