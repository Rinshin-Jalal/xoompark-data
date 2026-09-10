import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractFeaturedSpots, extractNextData, ingestFeaturedSpots } from './spotheroParse.ts';

// Recon (2026-08-23): the city landing page (spothero.com/miami-parking)
// ships no facility listings in __NEXT_DATA__ — pageProps there is just
// city metadata, Optimizely flags, and footer nav. The venue "destination"
// pages (spothero.com/destination/<city>/<slug>) DO embed real listings in
// pageProps.featuredSpots (id, title, address, lat/lng, live rate). The
// authenticated search API (api.spothero.com/v2/facilities) 401s without a
// bearer token, so it's out of reach for polite unauthenticated scraping.
// Using the general "Downtown Miami" destination as our one Miami source.
const SPOTHERO_URL = 'https://spothero.com/destination/miami/downtown-miami-parking';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 3-retry backoff on 429/5xx, mirrors fetchOverpassData in pitstop-finder/lib/finder.ts. */
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
  if (!res || !res.ok) throw new Error(`SpotHero fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export type SpotHeroPageResult = Awaited<ReturnType<typeof ingestFeaturedSpots>>;

/** Fetch+parse one SpotHero destination page, then delegate to ingestFeaturedSpots. Fails closed — never throws. */
async function ingestOnePage(url: string): Promise<SpotHeroPageResult> {
  let html: string;
  try {
    const res = await fetchWithRetry(url);
    html = await res.text();
  } catch (err) {
    return { url, ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let spots: ReturnType<typeof extractFeaturedSpots>;
  try {
    spots = extractFeaturedSpots(extractNextData(html));
  } catch (err) {
    return { url, ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestFeaturedSpots(url, spots, upsertSourcedLocation);
}

export async function ingestSpotHeroMiami(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const { ingested, skipped, errors } = await ingestOnePage(SPOTHERO_URL);
  return { ingested, skipped, errors };
}

// Recon (2026-08-23): downtown-miami-parking's pageProps.popularDestinations
// lists 20 other Miami venue destination pages (nav data, not facility
// listings). downtown-miami-parking itself is already covered by
// ingestSpotHeroMiami above, so it's excluded here — this is the remaining
// sweep set, capped at 14 to keep the combined run (14 + the 1 existing) at
// the ~15-page budget.
export const MIAMI_DESTINATION_SWEEP_URLS = [
  'https://spothero.com/destination/miami/kaseya-center-parking',
  'https://spothero.com/destination/miami/loandepot-park-parking',
  'https://spothero.com/destination/miami/bayside-marketplace-parking',
  'https://spothero.com/destination/miami/port-miami-parking',
  'https://spothero.com/destination/miami/james-l-knight-center-parking',
  'https://spothero.com/destination/miami/brickell-city-centre-parking',
  'https://spothero.com/destination/miami/brickell-parking',
  'https://spothero.com/destination/miami/miami-heat-parking',
  'https://spothero.com/destination/miami/bayfront-park-parking',
  'https://spothero.com/destination/miami/club-space-parking',
  'https://spothero.com/destination/miami/citizenm-miami-worldcenter-hotel-parking',
  'https://spothero.com/destination/miami/norwegian-cruise-line-terminal-b-parking',
  'https://spothero.com/destination/miami/miami-design-district-parking',
  'https://spothero.com/destination/miami/brightline-miami-station-parking',
];

export interface SpotHeroSweepSummary {
  pages: SpotHeroPageResult[];
  totalIngested: number;
  totalSkipped: number;
  errors: string[];
}

/**
 * Sweep a list of SpotHero Miami destination pages, max 2 concurrent
 * fetches at a time (politeness, same domain). Fails closed per page — a
 * 404 or missing featuredSpots on one page is recorded in that page's
 * errors[] and doesn't stop the rest of the sweep.
 */
export async function sweepSpotHeroMiamiDestinations(urls: string[]): Promise<SpotHeroSweepSummary> {
  const pages: SpotHeroPageResult[] = [];
  const CONCURRENCY = 2;

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((url) => ingestOnePage(url)));
    results.forEach((result, idx) => {
      const url = chunk[idx];
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        pages.push({ url, ingested: 0, skipped: 0, errors: [`unexpected failure: ${msg}`] });
      } else {
        pages.push(result.value);
      }
    });
  }

  return {
    pages,
    totalIngested: pages.reduce((sum, p) => sum + p.ingested, 0),
    totalSkipped: pages.reduce((sum, p) => sum + p.skipped, 0),
    errors: pages.flatMap((p) => p.errors.map((e) => `${p.url}: ${e}`)),
  };
}
