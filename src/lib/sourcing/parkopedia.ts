import 'server-only';
import { listSourcedLocations, upsertSourcedLocation } from './store.ts';
import {
  extractLocations,
  extractReactProps,
  findCrossSourceMatches,
  mapLocationToInput,
} from './parkopediaParse.ts';
import type { CrossSourceMatch } from './parkopediaParse.ts';

// Recon (2026-08-23): www.parkopedia.com/en/miami-parking/ 404s — that URL
// pattern doesn't exist. www.parkopedia.com/parking/miami_fl/ (and the
// .co.uk mirror) redirect 200 to en.parkopedia.com/parking/miami_fl/, a
// server-rendered (non-Next.js) page — no __NEXT_DATA__, no JSON-LD. The
// full listing set (152 spots for Miami: lots, garages, meters) ships in a
// `data-react-props` HTML attribute as HTML-entity-encoded JSON —
// props.locations.all[], each a GeoJSON Feature with numeric id, a
// lot/garage/meter detail url, static name/address/hours, and dynamic live
// price. Using that directly off the plain HTML fetch, no headless browser.
const PARKOPEDIA_URL = 'https://en.parkopedia.com/parking/miami_fl/';

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
  if (!res || !res.ok) throw new Error(`Parkopedia fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestParkopediaMiami(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  let html: string;
  try {
    const res = await fetchWithRetry(PARKOPEDIA_URL);
    html = await res.text();
  } catch (err) {
    errors.push(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ingested, skipped, errors };
  }

  let locations: ReturnType<typeof extractLocations>;
  try {
    locations = extractLocations(extractReactProps(html));
  } catch (err) {
    errors.push(`parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ingested, skipped, errors };
  }

  // Each upsert is a get+set round trip; awaiting all 150+ listings one at a
  // time serializes ~300 network calls. Chunked concurrency keeps this fast
  // without unbounded-parallel bursting the same doc's writes against itself.
  const CONCURRENCY = 12;
  for (let i = 0; i < locations.length; i += CONCURRENCY) {
    const chunk = locations.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((loc) => {
        const input = mapLocationToInput(loc);
        if (!input) return Promise.resolve(null);
        return upsertSourcedLocation(input);
      }),
    );
    chunk.forEach((loc, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`location ${loc.id ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}

/**
 * Report-only: reads current parkopedia + spothero records from the store
 * and returns likely duplicates by pin proximity + address overlap. Never
 * writes anything — confident-match auto-merge is a later feature.
 */
export async function reportParkopediaSpotHeroMatches(): Promise<CrossSourceMatch[]> {
  const all = await listSourcedLocations({});
  const parkopediaRecords = all.filter((r) => r.source_name === 'parkopedia');
  const spotheroRecords = all.filter((r) => r.source_name === 'spothero');
  return findCrossSourceMatches(parkopediaRecords, spotheroRecords);
}
