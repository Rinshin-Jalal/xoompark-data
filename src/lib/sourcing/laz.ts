import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { ingestLazFacilities } from './lazParse.ts';
import type { LazFacilityPage } from './lazParse.ts';

// Recon (2026-08-24): plain fetch on lazparking.com (homepage, /local/miami,
// /sitemap.xml — all of it) 403s behind a Cloudflare "Just a moment..." JS
// challenge; no HTML shell to parse at all, unlike SpotHero/Parkopedia.
// Firecrawl's rendered scrape gets a real 200 with actual page content
// through the same challenge (see step-1/2 recon report for the full
// before/after). The citywide "GEO Search" facility-finder widget at
// /local/venues/miami-fl never resolves — it's an interactive
// Google-Places-driven map widget that calls out to a JS-computed AJAX
// endpoint, not a server-rendered list, and stayed stuck on "Loading..."
// even at a 9s Firecrawl waitFor. Firecrawl's /v1/map link-discovery
// endpoint (cheap, no full render) found LAZ's individual facility detail
// pages instead — flat, static, same-Cloudflare-gated-but-Firecrawl-passable
// pages at /local/<city>-fl/<facility-slug>, each with a clean name/address/
// hours block in markdown.
//
// This is the full Miami-area set /v1/map surfaced when searched for
// "miami" and cross-checked against the site's full link list (verified
// 2026-08-24) — 10 facilities across Miami, Miami Beach, South Miami, and
// Coconut Grove. No pagination and no further per-city URL pattern to
// guess: this appears to be LAZ's complete SEO-indexable facility-page
// footprint for the Miami metro, not one page of a larger paginated set.
const MIAMI_FACILITY_URLS = [
  'https://www.lazparking.com/local/miami-fl/cocowalk',
  'https://www.lazparking.com/local/miami-fl/wynwood-garage',
  'https://www.lazparking.com/local/miami-beach-fl/404-washington-avenue',
  'https://www.lazparking.com/local/miami-beach-fl/500-collins',
  'https://www.lazparking.com/local/miami-beach-fl/555-washington-avenue',
  'https://www.lazparking.com/local/miami-beach-fl/1601-washington-avenue',
  'https://www.lazparking.com/local/miami-beach-fl/mt-sinai-medical-complex',
  'https://www.lazparking.com/local/south-miami-fl/plaza-57',
  'https://www.lazparking.com/local/south-miami-fl/shops-at-sunset-place',
  'https://www.lazparking.com/local/coconut-grove-fl/sbs-tower',
];

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape';

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: { markdown?: string };
  error?: string;
}

/**
 * POST one URL to Firecrawl's /v1/scrape, markdown format only. 3-retry
 * backoff on 429/5xx, mirrors fetchWithRetry in spothero.ts/parkopedia.ts —
 * same politeness pattern, just against Firecrawl's API instead of the
 * target site directly (Firecrawl handles the target site's own rate
 * limiting/challenge). Never logs the API key, only whether it's present.
 */
async function fetchFirecrawlMarkdown(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');

  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`Firecrawl scrape failed for ${url}: HTTP ${lastStatus || res?.status}`);

  const body = (await res.json()) as FirecrawlScrapeResponse;
  if (!body.success || typeof body.data?.markdown !== 'string') {
    throw new Error(`Firecrawl scrape returned no markdown for ${url}: ${body.error ?? 'unknown error'}`);
  }
  return body.data.markdown;
}

export async function ingestLazMiami(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const fetchErrors: string[] = [];
  const pages: LazFacilityPage[] = [];

  // Low concurrency — politeness toward Firecrawl's own rate limit and this
  // spike's ~20-scrape-call credit budget (see recon report), not the
  // target site's (Firecrawl already handled that).
  const CONCURRENCY = 3;
  for (let i = 0; i < MIAMI_FACILITY_URLS.length; i += CONCURRENCY) {
    const chunk = MIAMI_FACILITY_URLS.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((url) => fetchFirecrawlMarkdown(url)));
    results.forEach((result, idx) => {
      const url = chunk[idx];
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        fetchErrors.push(`${url}: fetch failed: ${msg}`);
      } else {
        pages.push({ url, markdown: result.value });
      }
    });
  }

  const mapped = await ingestLazFacilities(pages, upsertSourcedLocation);
  return { ingested: mapped.ingested, skipped: mapped.skipped, errors: [...fetchErrors, ...mapped.errors] };
}
