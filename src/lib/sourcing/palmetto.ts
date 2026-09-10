import 'server-only';
import { upsertSourcedLocation } from './store.ts';
import { extractPalmettoPlacemarks, ingestPalmettoPlacemarks } from './palmettoParse.ts';

// Recon (2026-08-25): palmettoparking.com embeds a Google My Maps iframe
// whose KML export is public and unauthenticated — 52 geocoded placemarks
// (lot number + "ADDRESS - HOURS" description + coordinates) for free, no
// headless browser and no WAF. The mid was pulled from the iframe src on
// palmettoparking.com/find-parking/.
const PALMETTO_KML_URL =
  'https://www.google.com/maps/d/kml?mid=1dcQwPtyxqyoekOmCT-bj2H1pq3M&forcekml=1';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 3-retry backoff on 429/5xx, mirrors fetchWithRetry in spothero.ts. */
async function fetchWithRetry(url: string): Promise<Response> {
  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' }, cache: 'no-store' });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`Palmetto KML fetch failed: ${lastStatus || res?.status}`);
  return res;
}

export async function ingestPalmetto(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let kml: string;
  try {
    kml = await (await fetchWithRetry(PALMETTO_KML_URL)).text();
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let placemarks: ReturnType<typeof extractPalmettoPlacemarks>;
  try {
    placemarks = extractPalmettoPlacemarks(kml);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestPalmettoPlacemarks(placemarks, upsertSourcedLocation);
}