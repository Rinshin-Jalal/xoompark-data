import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractMiamiBeachGarages, ingestGarages } from './miamiBeachParse.ts';

// Recon (2026-08-25): the Miami Beach parking-garage-rates page is a plain
// server-rendered page — no WAF, no JS framework. 11 <h3> garage-name
// headings, each followed by exactly one <table> rate schedule (verified
// 1:1 on a real fetch — see miamiBeachParse.ts).
const MIAMI_BEACH_URL =
  'https://www.miamibeachfl.gov/city-hall/parking/parking-garages-lot-locations/parking-garage-rates/';

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
  if (!res || !res.ok) throw new Error(`Miami Beach fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestMiamiBeach(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let html: string;
  try {
    html = await (await fetchWithRetry(MIAMI_BEACH_URL)).text();
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let garages: ReturnType<typeof extractMiamiBeachGarages>;
  try {
    garages = extractMiamiBeachGarages(html);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestGarages(MIAMI_BEACH_URL, garages, upsertSourcedLocation);
}