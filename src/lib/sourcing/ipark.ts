import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractIparkDetail, extractIparkGarages, ingestIparkGarages } from './iparkParse.ts';
import type { IparkEntry, IparkGarage } from './iparkParse.ts';

// Recon (2026-08-25): ipark.com's WP REST API (wp-json/wp/v2/garage) is
// public and unauthenticated — 161 garages across 2 pages, each with a name
// and a detail-page link. The list carries no address/hours (acf/content are
// empty server-side), so each garage's detail page is fetched for its
// .info-line "Address:"/"Hours:" divs (see iparkParse.ts). No WAF, no
// headless browser.
const IPARK_LIST_URL = 'https://ipark.com/wp-json/wp/v2/garage';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 3-retry backoff on 429/5xx, mirrors fetchWithRetry in spothero.ts. */
async function fetchWithRetry(url: string): Promise<Response> {
  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, cache: 'no-store' });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`iPark fetch failed: ${lastStatus || res?.status}`);
  return res;
}

/**
 * Fetch all garage list pages (per_page=100, loop until a short/empty page).
 * Exported so sourceUrlFetch.ts's admin "Paste URL" panel can reuse the exact
 * pagination logic instead of duplicating it.
 */
export async function fetchAllGarages(): Promise<IparkGarage[]> {
  const all: IparkGarage[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchWithRetry(`${IPARK_LIST_URL}?per_page=100&page=${page}`);
    const garages = extractIparkGarages(await res.json());
    if (garages.length === 0) break;
    all.push(...garages);
    if (garages.length < 100) break;
  }
  return all;
}

/** Exported so sourceUrlFetch.ts can reuse this exact per-garage detail fetch. */
export async function fetchDetail(garage: IparkGarage): Promise<IparkEntry> {
  const html = await (await fetchWithRetry(garage.link!)).text();
  return { garage, detail: extractIparkDetail(html) };
}

export async function ingestIpark(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let garages: IparkGarage[];
  try {
    garages = await fetchAllGarages();
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`list fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const entries: IparkEntry[] = [];
  const errors: string[] = [];

  // Low concurrency — politeness toward the same WP host across 161 detail
  // pages, same pattern as laz.ts's Firecrawl sweep.
  const CONCURRENCY = 3;
  for (let i = 0; i < garages.length; i += CONCURRENCY) {
    const chunk = garages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((g) => fetchDetail(g)));
    results.forEach((result, idx) => {
      const garage = chunk[idx];
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${garage.name ?? garage.link ?? '?'}: ${msg}`);
      } else {
        entries.push(result.value);
      }
    });
  }

  const mapped = await ingestIparkGarages(entries, upsertSourcedLocation);
  return { ingested: mapped.ingested, skipped: mapped.skipped, errors: [...errors, ...mapped.errors] };
}