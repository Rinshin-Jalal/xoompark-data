import 'server-only';
import { extractNextData } from './spotheroParse.ts';
import { extractFacilityQueryData, mapFacilityDetailToInput, selectUnenrichedSpotHero } from './spotheroDetailParse.ts';
import { listSourcedLocations, markSourcedLocationEnriched, upsertSourcedLocation } from './store.ts';
import type { SourcedParkingLocation } from './types.ts';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 3-retry backoff on 429/5xx — same as spothero.ts's fetchWithRetry. */
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
  if (!res || !res.ok) throw new Error(`SpotHero facility fetch failed: ${lastStatus || res?.status}`);
  return res;
}

/** Fetch+parse+upsert one facility, then stamp enriched_at. Fails closed — never throws. */
async function enrichOne(record: SourcedParkingLocation): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!record.source_listing_id) {
    // Shouldn't happen: the city-tier mapper only ever creates spothero
    // docs that have a spotId (see mapFeaturedSpotToInput in
    // spotheroParse.ts) — guarded here anyway so an unexpected record
    // fails closed instead of corrupting the dedupe key.
    return { ok: false, error: `${record.id}: no source_listing_id on a spothero record` };
  }
  try {
    const res = await fetchWithRetry(record.source_url);
    const html = await res.text();
    const detail = extractFacilityQueryData(extractNextData(html));
    if (!detail) throw new Error('facility query data not found in __NEXT_DATA__');
    const input = mapFacilityDetailToInput(detail, record.source_url, record.source_listing_id);
    const doc = await upsertSourcedLocation(input);
    await markSourcedLocationEnriched(doc.id, new Date().toISOString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `${record.source_url}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Second-tier enricher: visit each already-sourced SpotHero facility's own
 * detail page for richer fields (clearanceText, fuller hoursText/priceText)
 * and merge them into the existing record via the normal
 * upsertSourcedLocation/buildUpsertDoc fill-empty/conflict path — see
 * spotheroDetailParse.ts for the parse/map logic and types.ts for the merge
 * rules. Max 2 concurrent fetches (politeness, same domain as the city-page
 * sweep), fails closed per record.
 */
export async function enrichSpotHeroFacilities(
  limit = 20,
): Promise<{ enriched: number; skipped: number; errors: string[] }> {
  // ponytail: full in-memory scan+filter, same call shape as the existing
  // listSourcedLocations(mergedInto) filtering — fine at ~50-200 docs; swap
  // for a Firestore `where('source','==','spothero').where('enriched_at','==',null)`
  // composite-indexed query if this collection grows much larger.
  const all = await listSourcedLocations();
  const allSpothero = all.filter((r) => r.source_name === 'spothero');
  const skipped = allSpothero.filter((r) => r.enriched_at).length;
  const candidates = selectUnenrichedSpotHero(allSpothero, limit);

  const errors: string[] = [];
  let enriched = 0;
  const CONCURRENCY = 2;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((record) => enrichOne(record)));
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${chunk[idx].source_url}: unexpected failure: ${msg}`);
      } else if (!result.value.ok) {
        errors.push(result.value.error);
      } else {
        enriched++;
      }
    });
  }

  return { enriched, skipped, errors };
}
