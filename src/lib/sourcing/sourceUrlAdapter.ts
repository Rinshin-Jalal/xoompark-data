// Pure URL classification for the admin "Paste URL" panel — deliberately
// network- and Firestore-free (same split as spotheroParse.ts/
// parkopediaParse.ts) so it runs under plain `node --experimental-strip-types`.
//
// Recon (2026-08-25): confirmed path shapes via real fetches.
// SpotHero: /destination/<city>/<slug> = listing (spothero.ts's
// MIAMI_DESTINATION_SWEEP_URLS), /facility/<spotId>/<slug>-parking = single
// facility (the sourceUrl shape mapFeaturedSpotToInput in spotheroParse.ts
// already builds).
// Parkopedia: /parking/<city_slug>/ = listing (parkopedia.ts's
// PARKOPEDIA_URL), /parking/(meter|lot|garage)/<slug>/<zip>/<city>/ = single
// location — the three location "type" segments observed across all 152
// entries on en.parkopedia.com/parking/miami_fl/ (properties.static.url on
// each entry). Both www.parkopedia.com and en.parkopedia.com resolve (see
// parkopedia.ts's own recon comment on the redirect quirk).
//
// The 14 sources added in commit 8759a32 (miami-beach through parkwhiz below)
// are each a fixed, no-argument, single-source sweep (their real
// ingestXXX() functions in src/lib/sourcing/*.ts take no URL parameter — they
// always hit the same hardcoded page/API) — unlike SpotHero/Parkopedia there
// is no varying path shape to classify within one of these domains, so
// classification is pure hostname matching via SINGLE_SWEEP_HOSTS below: any
// path on a matching host classifies to that source's one kind. A couple
// proxy through a different domain internally at fetch time (Palmetto hits a
// Google My Maps KML export, ParkWhiz hits api.parkwhiz.com) but are still
// classified by the public-facing domain an admin would actually paste — see
// sourceUrlFetch.ts's fetchPalmetto/fetchParkWhiz.

export type SourceUrlKind =
  | 'spothero-listing'
  | 'spothero-facility'
  | 'parkopedia-listing'
  | 'parkopedia-location'
  | 'miami-beach'
  | 'portmiami'
  | 'mia-airport'
  | 'tamu'
  | 'umich'
  | 'ucdavis'
  | 'gatech'
  | 'sylvan'
  | 'ipark'
  | 'securehi'
  | 'palmetto'
  | 'gachas'
  | 'parkingo'
  | 'parkwhiz'
  | 'unknown';

/** Fixed single-source sweeps — classify by hostname alone, any path matches. */
const SINGLE_SWEEP_HOSTS: Record<string, SourceUrlKind> = {
  'miamibeachfl.gov': 'miami-beach',
  'miamidade.gov': 'portmiami',
  'miami-airport.com': 'mia-airport',
  'transport.tamu.edu': 'tamu',
  'ltp.umich.edu': 'umich',
  'health.ucdavis.edu': 'ucdavis',
  'pts.gatech.edu': 'gatech',
  'sylvanparking.com': 'sylvan',
  'ipark.com': 'ipark',
  'secureparkinghi.com': 'securehi',
  'palmettoparking.com': 'palmetto',
  'gachasparking.com': 'gachas',
  'parkingo.com': 'parkingo',
  'parkwhiz.com': 'parkwhiz',
};

function classifySpotHero(url: URL): SourceUrlKind {
  const { pathname, searchParams } = url;
  if (pathname.startsWith('/destination/')) return 'spothero-listing';
  if (pathname.startsWith('/facility/')) return 'spothero-facility';
  // Recon (2026-08-28): /search?...&spot-id=<id> is SpotHero's own
  // "share this spot" link shape (city/map search results with one spot
  // highlighted) — same facility id as a /facility/<id>/<slug> URL, just
  // carried as a query param instead of a path segment. The /search page
  // itself ships no facility data (client-rendered off an authenticated
  // API — see spothero.ts's recon comment), so this still routes through
  // the facility fetch, which resolves the id via a redirect regardless of
  // slug (see extractSpotHeroFacilityId/fetchSpotHeroFacility in
  // sourceUrlFetch.ts).
  if (pathname === '/search' && searchParams.has('spot-id')) return 'spothero-facility';
  return 'unknown';
}

function classifyParkopedia(pathname: string): SourceUrlKind {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'parking') return 'unknown';
  if (parts.length >= 2 && ['meter', 'lot', 'garage'].includes(parts[1])) return 'parkopedia-location';
  if (parts.length === 2) return 'parkopedia-listing';
  return 'unknown';
}

/** Never throws — an unparseable URL just classifies as 'unknown', caller shows an error to the admin. */
export function classifySourceUrl(url: string): SourceUrlKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'unknown';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'unknown';

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'spothero.com') return classifySpotHero(parsed);
  if (host === 'parkopedia.com' || host.endsWith('.parkopedia.com')) return classifyParkopedia(parsed.pathname);
  return SINGLE_SWEEP_HOSTS[host] ?? 'unknown';
}
