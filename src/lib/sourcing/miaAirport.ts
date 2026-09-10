import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractGarageNames, extractRateRows, formatRateText, ingestMiaGarages } from './miaAirportParse.ts';

// Recon (2026-08-25): miami-airport.com/airport-parking.asp is a plain
// server-rendered page — no WAF, no JS framework. Two static tables carry
// the data: the "Parking Location / Accessible Parking / Van Accessible
// Parking" table (garage names) and the class="table table-sm" rate table
// (one campus-wide hourly/max rate). A third table (class="GarageTable") is
// JS-filled live space counts — not scrapable, deliberately skipped (see
// miaAirportParse.ts).
const MIA_URL = 'https://www.miami-airport.com/airport-parking.asp';

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
  if (!res || !res.ok) throw new Error(`MIA Airport fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestMiaAirport(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let html: string;
  try {
    html = await (await fetchWithRetry(MIA_URL)).text();
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let names: string[];
  let priceText: string | undefined;
  try {
    names = extractGarageNames(html);
    priceText = formatRateText(extractRateRows(html));
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestMiaGarages(MIA_URL, names, priceText, upsertSourcedLocation);
}