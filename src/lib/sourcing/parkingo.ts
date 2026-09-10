import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractParkingoProducts, ingestParkingoProducts } from './parkingoParse.ts';

// Recon (2026-08-25): parkingo.com's /en/sitemap.xml lists ~44 airport pages
// (/en/parking-airport-<slug>). Each page's #compare-parkings section carries
// server-rendered product blocks (div.brand-type-element) — but only on the
// Italian direct-booking airports (rome-fiumicino, milan-malpensa-t1-t2,
// venice-tessera, bologna-borgo-panigale, ...). German/comparison-portal
// pages (frankfurt, dusseldorf, hamburg, cologne) carry zero product blocks,
// so the sweep ingests nothing from them — see parkingoParse.ts.
const PARKINGO_SITEMAP_URL = 'https://www.parkingo.com/en/sitemap.xml';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 3-retry backoff on 429/5xx, mirrors fetchWithRetry in spothero.ts. */
async function fetchWithRetry(url: string): Promise<Response> {
  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, cache: 'no-store' });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`ParkinGO fetch failed: ${lastStatus || res?.status}`);
  return res;
}

/** Pull every /en/parking-airport-* URL out of the sitemap. */
function extractAirportUrls(sitemapXml: string): string[] {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.includes('/en/parking-airport-'));
}

export async function ingestParkingo(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let urls: string[];
  try {
    const sitemap = await (await fetchWithRetry(PARKINGO_SITEMAP_URL)).text();
    urls = extractAirportUrls(sitemap);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`sitemap fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Low page-fetch concurrency — politeness toward the target site across
  // ~44 airport pages, separate from the upsert concurrency inside
  // ingestParkingoProducts.
  const CONCURRENCY = 3;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (url) => {
        const html = await (await fetchWithRetry(url)).text();
        return { url, products: extractParkingoProducts(html) };
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`page fetch failed: ${msg}`);
        continue;
      }
      const { url, products } = result.value;
      const mapped = await ingestParkingoProducts(url, products, upsertSourcedLocation);
      ingested += mapped.ingested;
      skipped += mapped.skipped;
      errors.push(...mapped.errors);
    }
  }

  return { ingested, skipped, errors };
}