import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractUmichLotRows, extractUmichPriceText, ingestUmichLots } from './umichParse.ts';

// Recon (2026-08-25): the live UMich campus-visitor-parking page is
// Cloudflare-gated — a plain fetch with a real Chrome User-Agent still gets
// the JS challenge page, not the article HTML. A Wayback Machine snapshot
// from 2026-07-31 serves the real rendered page, so this fetches that
// archived URL instead of the live one (see umichParse.ts for the full
// writeup — this is a genuine live-fetch block, not a shortcut).
const UMICH_URL =
  'https://web.archive.org/web/20260731184213/https://ltp.umich.edu/parking/patient-and-visitor/campus-visitor-parking/';

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
  if (!res || !res.ok) throw new Error(`UMich fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestUmich(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let html: string;
  try {
    html = await (await fetchWithRetry(UMICH_URL)).text();
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let rows: ReturnType<typeof extractUmichLotRows>;
  let priceText: string | undefined;
  try {
    rows = extractUmichLotRows(html);
    priceText = extractUmichPriceText(html);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestUmichLots(UMICH_URL, rows, priceText, upsertSourcedLocation);
}