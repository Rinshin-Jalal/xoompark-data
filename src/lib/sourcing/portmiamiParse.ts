// Pure parse/map logic for the PortMiami adapter — deliberately network- and
// Firestore-free (same split as spotheroParse.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

/** The entities actually observed on this page (&ndash; &amp; &rsquo; &nbsp;). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PortMiamiFacility {
  name: string;
  address?: string;
}

export interface PortMiamiRateBlock {
  heading: string;
  lines: string[];
}

/**
 * Pull the "Parking Garage Addresses" list — each <li> is "Name – Address"
 * (en-dash separated). Verified against a real fetch of
 * miamidade.gov/portmiami/parking-information.page on 2026-08-25: 11 entries
 * (Garage AA/A/B/C/D/G/J/K + Surface Lot C/D/E).
 */
export function extractPortMiamiFacilities(html: string): PortMiamiFacility[] {
  const marker = 'Parking Garage Addresses';
  const i = html.indexOf(marker);
  if (i === -1) return [];
  const ulStart = html.indexOf('<ul', i);
  const ulEnd = html.indexOf('</ul>', ulStart);
  if (ulStart === -1 || ulEnd === -1) return [];

  const facilities: PortMiamiFacility[] = [];
  for (const liMatch of html.slice(ulStart, ulEnd).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const text = stripTags(liMatch[1]);
    const parts = text.split(/\s*[\u2013\u2014]\s*/);
    if (parts.length >= 2 && parts[0].trim()) {
      facilities.push({ name: parts[0].trim(), address: parts[1].trim() });
    }
  }
  return facilities;
}

/**
 * Pull the "Rates & Payment" prose blocks — each is a
 * <p><strong>HEADING</strong></p> followed by a <ul> of rate lines. The
 * leading "Payment for All Garages and Surface Lots" block (payment methods,
 * not rates) is captured too but never matches a facility name, so it's
 * harmless. Verified 2026-08-25.
 */
export function extractPortMiamiRateBlocks(html: string): PortMiamiRateBlock[] {
  const marker = 'Rates &amp; Payment';
  const i = html.indexOf(marker);
  if (i === -1) return [];
  const section = html.slice(i);

  const blocks: PortMiamiRateBlock[] = [];
  const blockRe = /<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>\s*<ul[^>]*>([\s\S]*?)<\/ul>/g;
  for (const m of section.matchAll(blockRe)) {
    const heading = stripTags(m[1]);
    const lines = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => stripTags(x[1]));
    if (heading) blocks.push({ heading, lines });
  }
  return blocks;
}

/** Lowercase, "Garages" -> "Garage", strip punctuation — for heading matching. */
function normalizeHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/garages/g, 'garage')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the rate block for a facility name. Exact normalized-heading match
 * wins (e.g. "Surface Lot E" has its own block AND appears in the grouped
 * "Garages C, D, F, G and Surface Lot E" block); otherwise a word-boundary
 * substring match ("Garage C" -> the grouped block, but "Garage A" does NOT
 * match "Garage AA" — the \b stops the prefix bleed).
 */
export function findRateBlock(name: string, blocks: PortMiamiRateBlock[]): PortMiamiRateBlock | undefined {
  const normalized = normalizeHeading(name);
  const exact = blocks.find((b) => normalizeHeading(b.heading) === normalized);
  if (exact) return exact;
  const re = new RegExp(`\\b${escapeRegex(normalized)}\\b`);
  return blocks.find((b) => re.test(normalizeHeading(b.heading)));
}

/**
 * Map one PortMiami facility (+ its matched rate block) to the store's input
 * shape. The page has no per-facility detail page, so sourceUrl is
 * `<page-url>#<slugified-name>` and the same slug doubles as sourceListingId
 * (same convention as miaAirportParse.ts/miamiBeachParse.ts). Returns null
 * only when there's no name.
 */
export function mapFacilityToInput(
  facility: PortMiamiFacility,
  rateBlock: PortMiamiRateBlock | undefined,
  pageUrl: string,
): SourcedLocationInput | null {
  if (!facility.name) return null;

  const slug = slugifyCity(facility.name);
  const sourceUrl = `${pageUrl}#${slug}`;
  const priceText = rateBlock && rateBlock.lines.length ? rateBlock.lines.join('; ') : undefined;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (facility.address) fieldProvenance.address = 'self-reported';
  if (priceText) fieldProvenance.priceText = 'self-reported';

  return {
    name: facility.name,
    address: facility.address,
    source: 'portmiami',
    sourceUrl,
    sourceListingId: slug,
    priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: facility,
  };
}

export interface PortMiamiIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Core ingest logic: match each facility to its rate block, map to an input,
 * and hand it to the injected upsert. Network- and Firestore-free itself (the
 * upsert is injected) — same split as ingestFeaturedSpots/ingestLazFacilities.
 */
export async function ingestPortMiamiFacilities(
  pageUrl: string,
  facilities: PortMiamiFacility[],
  rateBlocks: PortMiamiRateBlock[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<PortMiamiIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < facilities.length; i += CONCURRENCY) {
    const chunk = facilities.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((facility) => {
        const input = mapFacilityToInput(facility, findRateBlock(facility.name, rateBlocks), pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((facility, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${facility.name || '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}