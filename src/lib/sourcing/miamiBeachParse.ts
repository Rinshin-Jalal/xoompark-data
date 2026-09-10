// Pure parse/map logic for the Miami Beach city-parking-rates adapter —
// deliberately network- and Firestore-free (same split as spotheroParse.ts)
// so it runs under plain `node --experimental-strip-types`, no 'server-only'
// guard tripping.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput, SourcedParkingLocation } from './types.ts';

/** The one entity actually observed in the garage heading text ("5th &amp; Alton"). */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&');
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Shape of one garage's rate schedule on the Miami Beach parking-garage-rates
// page. rateCells is the flattened, in-order list of cell text pulled from
// the garage's rate table — alternating HOURS/RATE tier pairs, with one
// trailing summary cell ("Maximum Daily Rate $X | Lost Ticket $X") — verified
// against a real fetch of the page on 2026-08-25.
export interface MiamiBeachGarageBlock {
  name: string;
  rateCells: string[];
}

/**
 * Pull each `<h3>` garage-name heading and its immediately-following
 * `<table>...</table>` rate schedule out of the page HTML via string-slicing
 * on the known tag boundaries (no HTML parser lib needed — every <h3> on
 * this page names a garage, and is followed by exactly one rate table before
 * the next <h3>). Real page (2026-08-25): 11 <h3> headings, 11 <table>s,
 * matching the prior recon 1:1 — no stray headings without a table.
 */
export function extractMiamiBeachGarages(html: string): MiamiBeachGarageBlock[] {
  const blocks: MiamiBeachGarageBlock[] = [];
  const H3_OPEN = '<h3>';
  const H3_CLOSE = '</h3>';

  let searchFrom = 0;
  while (true) {
    const h3Start = html.indexOf(H3_OPEN, searchFrom);
    if (h3Start === -1) break;
    const nameStart = h3Start + H3_OPEN.length;
    const nameEnd = html.indexOf(H3_CLOSE, nameStart);
    if (nameEnd === -1) break;
    const name = collapseWhitespace(decodeHtmlEntities(html.slice(nameStart, nameEnd)));

    const nextH3Start = html.indexOf(H3_OPEN, nameEnd);
    const boundary = nextH3Start === -1 ? html.length : nextH3Start;

    const tableStart = html.indexOf('<table', nameEnd);
    if (tableStart === -1 || tableStart > boundary) {
      // No rate table before the next heading (or end of page) — skip this
      // heading rather than guessing at a table that isn't there.
      searchFrom = boundary;
      continue;
    }
    const tableEnd = html.indexOf('</table>', tableStart);
    const tableHtml = tableEnd === -1 ? html.slice(tableStart, boundary) : html.slice(tableStart, tableEnd);

    const rateCells = [...tableHtml.matchAll(/<span class="content-text">([^<]*)<\/span>/g)].map((m) =>
      collapseWhitespace(decodeHtmlEntities(m[1])),
    );

    if (name) blocks.push({ name, rateCells });
    searchFrom = boundary;
  }

  return blocks;
}

/**
 * Turn a garage's flattened rate cells into one compact, readable price
 * string — never a fabricated single $/hr number when the real schedule is
 * tiered. Cells are consumed as (HOURS, RATE) pairs; an odd trailing cell
 * (the "Maximum Daily Rate ... | Lost Ticket ..." line, observed on every
 * garage on this page) is appended as-is rather than folded into a pair.
 */
export function buildRateScheduleText(rateCells: string[]): string | undefined {
  if (rateCells.length === 0) return undefined;
  const hasSummary = rateCells.length % 2 === 1;
  const pairCount = hasSummary ? rateCells.length - 1 : rateCells.length;

  const tiers: string[] = [];
  for (let i = 0; i < pairCount; i += 2) {
    tiers.push(`${rateCells[i]}: ${rateCells[i + 1]}`);
  }

  const summary = hasSummary ? rateCells[rateCells.length - 1] : undefined;
  const parts = [tiers.join(', ')].filter(Boolean);
  if (summary) parts.push(summary);
  return parts.join(' | ') || undefined;
}

/**
 * Map one garage block to the store's input shape. Miami Beach's rate page
 * has no per-facility detail page, so sourceUrl is built as
 * `<page-url>#<slugified-name>` — a stable, unique-ish URL per facility for
 * the evidence trail (per Brad's sourceUrl-required rule). The same slug
 * doubles as sourceListingId (no address on this page for the dedupe-by-
 * address fallback). Every garage on this page has a name, so this never
 * returns null in practice.
 */
export function mapGarageToInput(block: MiamiBeachGarageBlock, pageUrl: string): SourcedLocationInput | null {
  if (!block.name) return null;

  const priceText = buildRateScheduleText(block.rateCells);
  const slug = slugifyCity(block.name);
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (priceText) fieldProvenance.priceText = 'self-reported';

  return {
    name: block.name,
    source: 'miami-beach',
    sourceUrl,
    sourceListingId: slug,
    priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: block,
  };
}

export interface MiamiBeachIngestResult {
  url: string;
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core ingest logic: map each garage block to an input and hand it to the
 * injected upsert. Network- and Firestore-free itself (the upsert is
 * injected), same split as spotheroParse.ts's ingestFeaturedSpots — the real
 * miamiBeach.ts sweep just fetches+parses the page and calls this with the
 * real upsertSourcedLocation, and tests can pass an in-memory fake.
 */
export async function ingestGarages(
  url: string,
  garages: MiamiBeachGarageBlock[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<MiamiBeachIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < garages.length; i += CONCURRENCY) {
    const chunk = garages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((garage) => {
        const input = mapGarageToInput(garage, url);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((garage, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`garage ${garage.name || '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { url, ingested, skipped, errors };
}