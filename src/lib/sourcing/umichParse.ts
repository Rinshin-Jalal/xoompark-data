// Pure parse/map logic for the University of Michigan campus-visitor-parking
// adapter — deliberately network- and Firestore-free (same split as
// spotheroParse.ts/parkopediaParse.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
//
// Recon (2026-08-25): the live page (ltp.umich.edu/parking/patient-and-visitor/
// campus-visitor-parking/) is Cloudflare-gated — a plain fetch with a real
// Chrome User-Agent still gets served the JS challenge page ("Just a
// moment..."), not the article HTML. A Wayback Machine snapshot from
// 2026-07-31 serves the real rendered page, so umich.ts fetches that
// archived URL instead of the live one (see UMICH_URL there) — this is a
// genuine live-fetch block, not a shortcut of convenience.
//
// Real structure (verified against that Wayback snapshot): a WordPress/
// Elementor page with an intro paragraph stating the shared hourly rate,
// then two plain `<table>` elements (no class attribute; the second one
// carries an inline style but still no class) with matching column order —
// Lot | Name | Address | Enforcement Hours — one row per facility. The
// "Locations" table's Name cell wraps the facility name in an `<a>` link to
// a `/lot/?xyz=<id>` detail page, but that query param looks like an opaque/
// rotating token rather than a stable public URL, so it's deliberately NOT
// used as sourceUrl — falls back to the page-url + slug scheme instead, per
// the no-per-facility-detail-page convention.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface UmichLotRow {
  lot?: string;
  name?: string;
  address?: string;
  hoursText?: string;
}

/** Strip tags and decode the handful of HTML entities this page actually uses. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract every facility row from every `<table>` on the page — both the
 * big "Locations" table and the single-row Palmer Structure table share the
 * same Lot/Name/Address/Hours column order, so one pass over all tables
 * covers both.
 */
export function extractUmichLotRows(html: string): UmichLotRow[] {
  const rows: UmichLotRow[] = [];
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  for (const tableMatch of html.match(tableRe) ?? []) {
    const bodyStart = tableMatch.search(/<tbody[^>]*>/i);
    const body = bodyStart === -1 ? tableMatch : tableMatch.slice(bodyStart);

    let rowMatch: RegExpExecArray | null;
    rowRe.lastIndex = 0;
    while ((rowMatch = rowRe.exec(body))) {
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        cells.push(stripHtml(cellMatch[1]));
      }
      if (cells.length < 4) continue; // header row (th, not td) or malformed row
      const [lot, name, address, hoursText] = cells;
      rows.push({
        lot: lot || undefined,
        name: name || undefined,
        address: address || undefined,
        hoursText: hoursText || undefined,
      });
    }
  }

  return rows;
}

/**
 * Pull the shared hourly rate out of the intro prose (e.g. "Parking fees
 * are $2.60 per hour.") — stated once above the tables, not per-row.
 */
export function extractUmichPriceText(html: string): string | undefined {
  const match = html.match(/Parking fees are (\$[\d.]+ per hour)/i);
  return match?.[1];
}

/**
 * Map one UMich lot row to the store's input shape. `priceText` is the
 * page-level shared rate (same value applied to every row). Returns null
 * only when there's no name at all — a lot code/address/hours with no name
 * isn't usable.
 */
export function mapUmichLotToInput(
  row: UmichLotRow,
  pageUrl: string,
  priceText: string | undefined,
): SourcedLocationInput | null {
  if (!row.name) return null;

  const sourceUrl = `${pageUrl}#${slugifyCity(row.name)}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = {};
  for (const [field, present] of [
    ['name', true],
    ['address', !!row.address],
    ['hours_text', !!row.hoursText],
    ['price_text', !!priceText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    name: row.name,
    address: row.address,
    source: 'umich',
    sourceUrl,
    priceText,
    hoursText: row.hoursText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: row,
  };
}

export interface UmichIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core ingest logic over already-parsed rows: map each row and hand it to
 * the injected upsert. Network- and Firestore-free itself (the upsert is
 * injected) — same split as ingestFeaturedSpots/ingestLazFacilities, so
 * umich.ts's real sweep just fetches+parses the page and calls this with
 * the real upsertSourcedLocation, and tests can pass an in-memory fake.
 */
export async function ingestUmichLots(
  pageUrl: string,
  rows: UmichLotRow[],
  priceText: string | undefined,
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<UmichIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((row) => {
        const input = mapUmichLotToInput(row, pageUrl, priceText);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((row, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${row.lot ?? row.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}