import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractGachasLocations, ingestGachasLocations } from './gachasParse.ts';

// Recon (2026-08-25): gachasparking.com is a plain server-rendered page — no
// WAF, no JS framework. The #locations section carries 2 locations as
// <p>STREET,<br />CITY, STATE ZIP</p> blocks (see gachasParse.ts). Use the
// bare apex domain (www redirects).
const GACHAS_URL = 'https://gachasparking.com';

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
  if (!res || !res.ok) throw new Error(`Gacha's fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestGachas(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let html: string;
  try {
    html = await (await fetchWithRetry(GACHAS_URL)).text();
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let locations: ReturnType<typeof extractGachasLocations>;
  try {
    locations = extractGachasLocations(html);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestGachasLocations(GACHAS_URL, locations, upsertSourcedLocation);
}