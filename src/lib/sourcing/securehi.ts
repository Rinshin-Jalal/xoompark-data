import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import {
  extractSecurehiLocation,
  extractSecurehiLocationUrls,
  ingestSecurehiLocations,
} from './securehiParse.ts';
import type { SecurehiLocation } from './securehiParse.ts';

// Recon (2026-08-25): secureparkinghi.com is a plain server-rendered WP site
// (the bare domain 301s to www). The parking_location-sitemap.xml lists the
// location CPT pages, each with an <h1> name, an address <p>, and
// data_lat/data_lng on the #locationmap div (see securehiParse.ts). Rates
// live on WooCommerce product pages whose price is JS-loaded — deliberately
// not scraped here.
const SECUREHI_SITEMAP_URL = 'https://www.secureparkinghi.com/parking_location-sitemap.xml';

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
  if (!res || !res.ok) throw new Error(`Secure HI fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestSecurehi(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let urls: string[];
  try {
    const sitemap = await (await fetchWithRetry(SECUREHI_SITEMAP_URL)).text();
    urls = extractSecurehiLocationUrls(sitemap);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`sitemap fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const locations: SecurehiLocation[] = [];
  const errors: string[] = [];

  const CONCURRENCY = 3;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (url) => {
        const html = await (await fetchWithRetry(url)).text();
        return extractSecurehiLocation(html, url);
      }),
    );
    results.forEach((result, idx) => {
      const url = chunk[idx];
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${url}: ${msg}`);
      } else {
        locations.push(result.value);
      }
    });
  }

  const mapped = await ingestSecurehiLocations(locations, upsertSourcedLocation);
  return { ingested: mapped.ingested, skipped: mapped.skipped, errors: [...errors, ...mapped.errors] };
}