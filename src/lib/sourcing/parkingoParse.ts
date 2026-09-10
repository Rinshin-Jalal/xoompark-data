// Pure parse/map logic for the ParkinGO adapter — deliberately network- and
// Firestore-free (same split as spotheroParse.ts) so it runs under plain
// `node --experimental-strip-types`, no 'server-only' guard tripping.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface ParkingoProduct {
  name?: string;
  lotType?: string;
  priceText?: string;
  shuttleText?: string;
  distanceText?: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '\u20ac')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull each product out of a ParkinGO airport page's #compare-parkings
 * section. Each product is a <div class="brand-type-element"> block with:
 *   img.brand-logo[alt]  -> product name ("Parkingo GO1 Logo" -> "Parkingo GO1")
 *   img.type-icon[alt]   -> lot type (OUTDOOR/COVERED)
 *   p.h6.fw-semibold x3  -> price ("from €4.90 per day"), shuttle, distance
 * Verified against real fetches of /en/parking-airport-rome-fiumicino (4
 * products), milan-malpensa-t1-t2 (8), venice-tessera (6) on 2026-08-25.
 * NOTE: the pattern is NOT uniform — German/comparison-portal pages
 * (frankfurt, dusseldorf, hamburg, cologne) carry zero brand-type-element
 * blocks, so this returns [] for them; the sweep just ingests nothing.
 */
export function extractParkingoProducts(html: string): ParkingoProduct[] {
  const products: ParkingoProduct[] = [];
  const blockRe = /<div class="brand-type-element[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  for (const m of html.matchAll(blockRe)) {
    const block = m[1];
    const nameMatch = block.match(/<img class="brand-logo"[^>]*alt="([^"]*)"/);
    const typeMatch = block.match(/<img class="type-icon"[^>]*alt="([^"]*)"/);
    const h6Texts = [...block.matchAll(/<p class="[^"]*h6[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((x) => stripTags(x[1]));

    const name = nameMatch?.[1]?.replace(/\s+Logo\s*$/i, '').trim();
    if (!name) continue;

    products.push({
      name,
      lotType: typeMatch?.[1]?.trim(),
      priceText: h6Texts[0],
      shuttleText: h6Texts[1],
      distanceText: h6Texts[2],
    });
  }
  return products;
}

/**
 * Map one ParkinGO product to the store's input shape. No per-product detail
 * page, so sourceUrl is `<airport-page-url>#<slugified-name>`. The same
 * product brand can appear at multiple airports, so sourceListingId folds in
 * the airport slug to keep each airport's product a distinct record.
 * lotType/shuttle/distance have no schema field — they stay in rawInput.
 */
export function mapParkingoProductToInput(product: ParkingoProduct, pageUrl: string): SourcedLocationInput | null {
  if (!product.name) return null;

  const slug = slugifyCity(product.name);
  const airportSlug = pageUrl.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? 'airport';
  const sourceUrl = `${pageUrl}#${slug}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (product.priceText) fieldProvenance.priceText = 'self-reported';

  return {
    name: product.name,
    source: 'parkingo',
    sourceUrl,
    sourceListingId: `${airportSlug}-${slug}`,
    priceText: product.priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: product,
  };
}

export interface ParkingoIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed products — same split as ingestFeaturedSpots. */
export async function ingestParkingoProducts(
  pageUrl: string,
  products: ParkingoProduct[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<ParkingoIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const chunk = products.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((product) => {
        const input = mapParkingoProductToInput(product, pageUrl);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((product, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${product.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}