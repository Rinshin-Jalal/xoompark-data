import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { ingestQuotes } from './parkwhizParse.ts';
import type { ParkWhizQuote } from './parkwhizParse.ts';

// Recon (2026-08-25): parkwhiz.com's HTML is AWS-WAF-gated (202 JS challenge
// on plain fetch), but its public JSON API — api.parkwhiz.com/v4/quotes/ —
// is unauthenticated and returns full facility objects (name/address/
// entrance lat-lng + a live price) embedded in each quote. A single quotes
// call covers facilities near one coordinate, so this sweeps a coarse grid
// over the Miami metro and lets ingestQuotes dedup by location_id (a grid
// sweep hits the same facility from multiple points). No headless browser,
// no WAF bypass — just the API the site's own frontend calls.
const QUOTES_URL = 'https://api.parkwhiz.com/v4/quotes/';

// ponytail: coarse 0.05° grid (~5.5km) over the Miami metro — dense enough
// to surface most facilities, sparse enough to stay polite (25 calls).
// Tighten the step if a locality's facilities are being missed.
const GRID_LATS = [25.7, 25.75, 25.8, 25.85, 25.9];
const GRID_LNGS = [-80.3, -80.25, -80.2, -80.15, -80.1];

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** "YYYY-MM-DDTHH:MM:SS±HH:MM" — the format the quotes API accepts. */
function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Tomorrow 10:00–12:00 local — a fixed 2h window; the price is live anyway,
 *  the point is facility identity + a representative rate. */
function quoteWindow(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return { start: formatLocal(start), end: formatLocal(end) };
}

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
  if (!res || !res.ok) throw new Error(`ParkWhiz fetch failed: ${lastStatus || res?.status}`);
  return res;
}

async function fetchQuotesAt(lat: number, lng: number, start: string, end: string): Promise<ParkWhizQuote[]> {
  const url = `${QUOTES_URL}?q=coordinates:${lat},${lng}&start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`;
  const res = await fetchWithRetry(url);
  const body = (await res.json()) as ParkWhizQuote[];
  return Array.isArray(body) ? body : [];
}

/**
 * Sweep the coarse Miami-metro grid and return the raw quotes (+ any per-point
 * fetch errors) — network-only, no mapping/upsert. Exported so
 * sourceUrlFetch.ts's admin "Paste URL" panel can reuse the exact same grid
 * sweep instead of duplicating GRID_LATS/GRID_LNGS/quoteWindow/fetchQuotesAt.
 */
export async function fetchAllParkWhizQuotes(): Promise<{ quotes: ParkWhizQuote[]; errors: string[] }> {
  const { start, end } = quoteWindow();
  const points = GRID_LATS.flatMap((lat) => GRID_LNGS.map((lng) => ({ lat, lng })));

  const quotes: ParkWhizQuote[] = [];
  const errors: string[] = [];

  // Low concurrency — politeness toward the API, same pattern as laz.ts's
  // Firecrawl sweep.
  const CONCURRENCY = 3;
  for (let i = 0; i < points.length; i += CONCURRENCY) {
    const chunk = points.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((p) => fetchQuotesAt(p.lat, p.lng, start, end)));
    results.forEach((result, idx) => {
      const p = chunk[idx];
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${p.lat},${p.lng}: ${msg}`);
      } else {
        quotes.push(...result.value);
      }
    });
  }

  return { quotes, errors };
}

export async function ingestParkWhizMiami(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const { quotes, errors } = await fetchAllParkWhizQuotes();
  const mapped = await ingestQuotes(quotes, upsertSourcedLocation);
  return { ingested: mapped.ingested, skipped: mapped.skipped, errors: [...errors, ...mapped.errors] };
}