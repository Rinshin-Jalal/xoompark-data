import 'server-only';
import { extractFacilityQueryData, mapFacilityDetailToInput } from './spotheroDetailParse.ts';
import { extractFeaturedSpots, extractNextData, mapFeaturedSpotToInput } from './spotheroParse.ts';
import { extractActiveLocation, extractLocations, extractReactProps, mapLocationToInput } from './parkopediaParse.ts';
import { extractMiamiBeachGarages, ingestGarages } from './miamiBeachParse.ts';
import { extractPortMiamiFacilities, extractPortMiamiRateBlocks, ingestPortMiamiFacilities } from './portmiamiParse.ts';
import { extractGarageNames, extractRateRows, formatRateText, ingestMiaGarages } from './miaAirportParse.ts';
import { extractTamuGarages, extractTamuRateText, ingestTamuGarages } from './tamuParse.ts';
import { fetchText as fetchTamuText, TAMU_GARAGES_URL, TAMU_VISITOR_URL } from './tamu.ts';
import { extractUmichLotRows, extractUmichPriceText, ingestUmichLots } from './umichParse.ts';
import { extractUcdavisFacilities, ingestUcdavisFacilities } from './ucdavisParse.ts';
import { extractGatechFacilities, ingestGatechFacilities } from './gatechParse.ts';
import { extractSylvanRows, ingestSylvanRows } from './sylvanParse.ts';
import { ingestIparkGarages } from './iparkParse.ts';
import type { IparkEntry } from './iparkParse.ts';
import { fetchAllGarages as fetchAllIparkGarages, fetchDetail as fetchIparkDetail } from './ipark.ts';
import { extractSecurehiLocation, extractSecurehiLocationUrls, ingestSecurehiLocations } from './securehiParse.ts';
import type { SecurehiLocation } from './securehiParse.ts';
import { extractPalmettoPlacemarks, ingestPalmettoPlacemarks } from './palmettoParse.ts';
import { extractGachasLocations, ingestGachasLocations } from './gachasParse.ts';
import { extractParkingoProducts, ingestParkingoProducts } from './parkingoParse.ts';
import { ingestQuotes } from './parkwhizParse.ts';
import { fetchAllParkWhizQuotes } from './parkwhiz.ts';
import { classifySourceUrl } from './sourceUrlAdapter.ts';
import type { SourceUrlKind } from './sourceUrlAdapter.ts';
import { getSourcedLocation } from './store.ts';
import { computeDedupeKey, normalizeAddress } from './types.ts';
import type { SourcedLocationInput } from './types.ts';

// Thin server-only fetch+parse+dedupe-tag orchestrator for the admin
// "Paste URL" panel — classifies the pasted URL (sourceUrlAdapter.ts), then
// routes to the matching existing adapter's pure parse/map logic
// (spotheroParse.ts / spotheroDetailParse.ts / parkopediaParse.ts / the 14
// *Parse.ts files added in commit 8759a32) so nothing here reimplements
// parsing. Same dedupe-tag step as capture.ts's tagAgainstFirestore for the
// extension/paste-HTML pipeline, generalized from ExtractedFacility to
// SourcedLocationInput since these results already carry a real
// source/sourceListingId (no synthetic 'extension'/'manual' keyspace needed
// here).
//
// 16 sources total. The 14 added in 8759a32 are each a fixed, no-argument,
// single-source sweep (see sourceUrlAdapter.ts's doc comment) — their
// fetchX() functions below take no url and always hit the same hardcoded
// page(s)/API, reusing each source's real ingestXXX() building blocks
// (extract + map/ingest) via a collecting fake upsert (collectInputs below)
// instead of calling the real ingestXXX() orchestrator, which writes
// straight to Firestore via the real upsertSourcedLocation.
//
// Recon (2026-08-25) — Parkopedia individual-location detail page: fetched
// en.parkopedia.com/parking/garage/river_landing_shops_and_residences/33125/miami/
// and en.parkopedia.com/parking/meter/1891_northwest_21st_street/33142/miami/
// directly. Both ship the SAME `data-react-props` blob shape as the city
// listing page (parkopedia.ts's PARKOPEDIA_URL) — `locations.all` (the full
// city location set, ~150 entries) PLUS `locations.active` (a single entry,
// the one this detail page is about). Diffed `locations.active` against its
// own matching entry in `locations.all`: identical `properties.static`
// (name/address/capacity/height/features/payment_types/rate_tables/
// surface_type/access_points/...) and `properties.dynamic` shape — only
// `distance` (search-center-relative) and the live rate's
// `price`/`relevance`/`rating` differ, both request-context values, not
// different facts about the location. So the detail page is NOT a richer
// data source than the listing page already is — no separate
// parkopediaDetailParse.ts was written. Resolution: fetch the pasted
// location URL directly (not its parent city listing — the location page
// already carries the full react-props blob itself, one fetch instead of
// two, and avoids having to reconstruct a `<city>_<state>` listing slug from
// a location URL that only encodes the bare city name), pull out
// `locations.active` via the new extractActiveLocation in parkopediaParse.ts
// (same Feature shape as one `locations.all` entry, so mapLocationToInput
// applies unchanged), and map it through the existing
// extractReactProps/mapLocationToInput pipeline as-is.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ponytail: a 4th copy of the same 3-retry backoff already duplicated in
// spothero.ts / parkopedia.ts / enrichSpothero.ts (each file's own docstring
// says "mirrors fetchWithRetry in X") — matching that established
// copy-per-adapter convention here rather than extracting a shared helper,
// so this stays a self-contained one-file addition. Upgrade path: pull all
// four into one shared `fetchWithRetry` if a 5th call site ever needs it.
async function fetchWithRetry(url: string, label: string): Promise<Response> {
  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, cache: 'no-store' });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`${label} fetch failed: ${lastStatus || res?.status}`);
  return res;
}

/**
 * SpotHero facility URLs are shaped https://spothero.com/facility/<spotId>/<slug>-parking
 * (see mapFeaturedSpotToInput in spotheroParse.ts, which builds this exact
 * shape from spotId+slug). A freshly-pasted facility URL has no existing
 * Firestore record to read sourceListingId off (unlike enrichSpothero.ts's
 * enrichOne, which already has record.sourceListingId in hand) — parsed back
 * out of the URL here instead. Also handles the /search?...&spot-id=<id>
 * share-link shape classifySourceUrl routes here (see sourceUrlAdapter.ts).
 */
function extractSpotHeroFacilityId(url: string): string | null {
  const pathMatch = url.match(/\/facility\/([^/]+)\//);
  if (pathMatch) return pathMatch[1];
  return new URL(url).searchParams.get('spot-id');
}

async function fetchSpotHeroListing(url: string): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(url, 'SpotHero')).text();
  const spots = extractFeaturedSpots(extractNextData(html));
  const inputs: SourcedLocationInput[] = [];
  for (const spot of spots) {
    const input = mapFeaturedSpotToInput(spot);
    if (input) inputs.push(input);
  }
  return inputs;
}

/**
 * Recon (2026-08-28): a /search?...&spot-id=<id> share link ships no
 * facility data itself — it's client-rendered off an authenticated API
 * (api.spothero.com/v2/facilities, 401s unauthenticated — see spothero.ts).
 * SpotHero redirects any /facility/<id>/<anything> to the real canonical
 * slug regardless of what's there (confirmed via a real fetch), so once we
 * have the id, always fetch the canonical shape instead of the pasted URL —
 * covers both a real /facility/ URL (already canonical) and a /search share
 * link (which has no page of its own worth fetching).
 */
async function fetchSpotHeroFacility(url: string): Promise<SourcedLocationInput[]> {
  const spotId = extractSpotHeroFacilityId(url);
  if (!spotId) throw new Error(`could not parse a facility id out of ${url}`);
  const facilityUrl = url.includes('/facility/') ? url : `https://spothero.com/facility/${spotId}/parking`;
  const html = await (await fetchWithRetry(facilityUrl, 'SpotHero facility')).text();
  const detail = extractFacilityQueryData(extractNextData(html));
  if (!detail) throw new Error('facility query data not found in __NEXT_DATA__');
  return [mapFacilityDetailToInput(detail, facilityUrl, spotId)];
}

async function fetchParkopediaListing(url: string): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(url, 'Parkopedia')).text();
  const locations = extractLocations(extractReactProps(html));
  const inputs: SourcedLocationInput[] = [];
  for (const loc of locations) {
    const input = mapLocationToInput(loc);
    if (input) inputs.push(input);
  }
  return inputs;
}

async function fetchParkopediaLocation(url: string): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(url, 'Parkopedia')).text();
  const active = extractActiveLocation(extractReactProps(html));
  if (!active) throw new Error('locations.active not found in data-react-props — not a location detail page?');
  const input = mapLocationToInput(active);
  if (!input) throw new Error('Parkopedia location page is missing its own source URL');
  return [input];
}

/**
 * A fake upsert that collects every mapped input instead of writing it —
 * reused by every fetchX() below so the preview step gets the exact same
 * mapping/provenance logic each source's real ingestXXX() runs, without
 * touching Firestore. Same trick tests in this directory already use (see
 * e.g. tamu.test.ts's makeFakeStore), just discarding rather than storing.
 */
function collectInputs() {
  const collected: SourcedLocationInput[] = [];
  const upsert = (input: SourcedLocationInput): Promise<null> => {
    collected.push(input);
    return Promise.resolve(null);
  };
  return { collected, upsert };
}

// Recon (2026-08-25): www.miamibeachfl.gov, plain server-rendered page — see
// miamiBeach.ts.
const MIAMI_BEACH_URL =
  'https://www.miamibeachfl.gov/city-hall/parking/parking-garages-lot-locations/parking-garage-rates/';

async function fetchMiamiBeach(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(MIAMI_BEACH_URL, 'Miami Beach')).text();
  const garages = extractMiamiBeachGarages(html);
  const { collected, upsert } = collectInputs();
  await ingestGarages(MIAMI_BEACH_URL, garages, upsert);
  return collected;
}

// Recon (2026-08-25): www.miamidade.gov/portmiami — see portmiami.ts.
const PORTMIAMI_URL = 'https://www.miamidade.gov/portmiami/parking-information.page';

async function fetchPortMiami(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(PORTMIAMI_URL, 'PortMiami')).text();
  const facilities = extractPortMiamiFacilities(html);
  const rateBlocks = extractPortMiamiRateBlocks(html);
  const { collected, upsert } = collectInputs();
  await ingestPortMiamiFacilities(PORTMIAMI_URL, facilities, rateBlocks, upsert);
  return collected;
}

// Recon (2026-08-25): www.miami-airport.com — see miaAirport.ts.
const MIA_AIRPORT_URL = 'https://www.miami-airport.com/airport-parking.asp';

async function fetchMiaAirport(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(MIA_AIRPORT_URL, 'MIA Airport')).text();
  const names = extractGarageNames(html);
  const priceText = formatRateText(extractRateRows(html));
  const { collected, upsert } = collectInputs();
  await ingestMiaGarages(MIA_AIRPORT_URL, names, priceText, upsert);
  return collected;
}

/**
 * transport.tamu.edu needs the custom-TLS-agent fetch tamu.ts already built
 * (the server ships an incomplete cert chain) — reused via fetchTamuText
 * rather than duplicating the intermediate/root cert PEMs here.
 */
async function fetchTamu(): Promise<SourcedLocationInput[]> {
  const [garagesHtml, visitorHtml] = await Promise.all([
    fetchTamuText(TAMU_GARAGES_URL),
    fetchTamuText(TAMU_VISITOR_URL),
  ]);
  const garages = extractTamuGarages(garagesHtml);
  const rateText = extractTamuRateText(visitorHtml);
  const { collected, upsert } = collectInputs();
  await ingestTamuGarages(TAMU_GARAGES_URL, garages, rateText, upsert);
  return collected;
}

// Recon (2026-08-25): the live ltp.umich.edu page is Cloudflare-gated, so
// umich.ts fetches a Wayback Machine snapshot instead — see umich.ts. Admin
// pastes still classify by ltp.umich.edu (sourceUrlAdapter.ts); this internal
// fetch target is the one exception, same as umich.ts's own real sweep.
const UMICH_URL =
  'https://web.archive.org/web/20260731184213/https://ltp.umich.edu/parking/patient-and-visitor/campus-visitor-parking/';

async function fetchUmich(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(UMICH_URL, 'UMich')).text();
  const rows = extractUmichLotRows(html);
  const priceText = extractUmichPriceText(html);
  const { collected, upsert } = collectInputs();
  await ingestUmichLots(UMICH_URL, rows, priceText, upsert);
  return collected;
}

// Recon (2026-08-25): health.ucdavis.edu — see ucdavis.ts.
const UCDAVIS_URL = 'https://health.ucdavis.edu/parking/visitor/';

async function fetchUcdavis(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(UCDAVIS_URL, 'UC Davis')).text();
  const facilities = extractUcdavisFacilities(html);
  const { collected, upsert } = collectInputs();
  await ingestUcdavisFacilities(UCDAVIS_URL, facilities, upsert);
  return collected;
}

// Recon (2026-08-25): www.pts.gatech.edu — see gatech.ts.
const GATECH_URL = 'https://www.pts.gatech.edu/parking/visitor-parking/';

async function fetchGatech(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(GATECH_URL, 'Georgia Tech')).text();
  const facilities = extractGatechFacilities(html);
  const { collected, upsert } = collectInputs();
  await ingestGatechFacilities(GATECH_URL, facilities, upsert);
  return collected;
}

// Recon (2026-08-25): sylvanparking.com — see sylvan.ts.
const SYLVAN_URL = 'https://sylvanparking.com/locations-rates.html';

async function fetchSylvan(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(SYLVAN_URL, 'Sylvan')).text();
  const rows = extractSylvanRows(html);
  const { collected, upsert } = collectInputs();
  await ingestSylvanRows(SYLVAN_URL, rows, upsert);
  return collected;
}

/**
 * ipark.com's public WP REST API — reuses ipark.ts's exported
 * fetchAllIparkGarages (pagination) and fetchIparkDetail (per-garage
 * address/hours) rather than duplicating that loop, then the same low-
 * concurrency detail-page sweep ipark.ts's own ingestIpark() runs.
 */
async function fetchIpark(): Promise<SourcedLocationInput[]> {
  const garages = await fetchAllIparkGarages();
  const entries: IparkEntry[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < garages.length; i += CONCURRENCY) {
    const chunk = garages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((g) => fetchIparkDetail(g)));
    for (const result of results) {
      if (result.status === 'fulfilled') entries.push(result.value);
    }
  }
  const { collected, upsert } = collectInputs();
  await ingestIparkGarages(entries, upsert);
  return collected;
}

// Recon (2026-08-25): www.secureparkinghi.com's location-CPT sitemap — see securehi.ts.
const SECUREHI_SITEMAP_URL = 'https://www.secureparkinghi.com/parking_location-sitemap.xml';

async function fetchSecurehi(): Promise<SourcedLocationInput[]> {
  const sitemap = await (await fetchWithRetry(SECUREHI_SITEMAP_URL, 'Secure HI sitemap')).text();
  const urls = extractSecurehiLocationUrls(sitemap);
  const locations: SecurehiLocation[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (url) => {
        const html = await (await fetchWithRetry(url, 'Secure HI location')).text();
        return extractSecurehiLocation(html, url);
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') locations.push(result.value);
    }
  }
  const { collected, upsert } = collectInputs();
  await ingestSecurehiLocations(locations, upsert);
  return collected;
}

/**
 * palmettoparking.com embeds a Google My Maps iframe whose KML export is the
 * real fetch target regardless of what's pasted — see palmetto.ts. Admin
 * pastes still classify by palmettoparking.com (sourceUrlAdapter.ts).
 */
const PALMETTO_KML_URL = 'https://www.google.com/maps/d/kml?mid=1dcQwPtyxqyoekOmCT-bj2H1pq3M&forcekml=1';

async function fetchPalmetto(): Promise<SourcedLocationInput[]> {
  const kml = await (await fetchWithRetry(PALMETTO_KML_URL, 'Palmetto KML')).text();
  const placemarks = extractPalmettoPlacemarks(kml);
  const { collected, upsert } = collectInputs();
  await ingestPalmettoPlacemarks(placemarks, upsert);
  return collected;
}

// Recon (2026-08-25): gachasparking.com (bare apex — www redirects) — see gachas.ts.
const GACHAS_URL = 'https://gachasparking.com';

async function fetchGachas(): Promise<SourcedLocationInput[]> {
  const html = await (await fetchWithRetry(GACHAS_URL, "Gacha's")).text();
  const locations = extractGachasLocations(html);
  const { collected, upsert } = collectInputs();
  await ingestGachasLocations(GACHAS_URL, locations, upsert);
  return collected;
}

// Recon (2026-08-25): www.parkingo.com/en/sitemap.xml lists the airport pages — see parkingo.ts.
const PARKINGO_SITEMAP_URL = 'https://www.parkingo.com/en/sitemap.xml';

async function fetchParkingo(): Promise<SourcedLocationInput[]> {
  const sitemap = await (await fetchWithRetry(PARKINGO_SITEMAP_URL, 'ParkinGO sitemap')).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.includes('/en/parking-airport-'));

  const { collected, upsert } = collectInputs();
  const CONCURRENCY = 3;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (url) => ({ url, products: extractParkingoProducts(await (await fetchWithRetry(url, 'ParkinGO airport page')).text()) })),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') await ingestParkingoProducts(result.value.url, result.value.products, upsert);
    }
  }
  return collected;
}

/**
 * parkwhiz.com's HTML is WAF-gated, so parkwhiz.ts sweeps its public
 * api.parkwhiz.com JSON API on a coarse Miami-metro grid instead — reused
 * via fetchAllParkWhizQuotes rather than duplicating the grid math. Admin
 * pastes still classify by parkwhiz.com (sourceUrlAdapter.ts).
 */
async function fetchParkWhiz(): Promise<SourcedLocationInput[]> {
  const { quotes } = await fetchAllParkWhizQuotes();
  const { collected, upsert } = collectInputs();
  await ingestQuotes(quotes, upsert);
  return collected;
}

export type SourceLocationTag = 'NEW' | 'EXISTS' | 'DUPLICATE';

export interface TaggedSourceLocation extends SourcedLocationInput {
  dedupeKey: string;
  tag: SourceLocationTag;
  existingId?: string;
}

/**
 * computeDedupeKey (types.ts) throws when an input has neither
 * sourceListingId nor a usable address — every mapper here already returns
 * null for inputs it can't build a real record from, but Parkopedia's
 * loc.id is technically optional, so this stays defensive. An item that
 * fails is dropped from the tag/lookup batch (upsertSourcedLocation would
 * hit the exact same wall on import) rather than failing the whole fetch.
 */
function safeDedupeKey(input: SourcedLocationInput): string | null {
  try {
    const normalizedAddress = input.normalizedAddress
      ?? (input.address ? normalizeAddress(input.address) : undefined);
    return computeDedupeKey({
      source: input.source,
      sourceListingId: input.sourceListingId,
      normalizedAddress,
      address: input.address,
    });
  } catch {
    return null;
  }
}

/**
 * Dedupe-tag results against Firestore — same NEW/EXISTS/DUPLICATE decision
 * as capture.ts's tagAgainstFirestore, generalized to SourcedLocationInput
 * (these already carry a real source/sourceListingId, unlike
 * extensionCapture.ts's tagExtractedFacilities which computes a synthetic
 * key for facilities with no adapter-assigned id).
 */
async function tagAgainstFirestore(inputs: SourcedLocationInput[]): Promise<TaggedSourceLocation[]> {
  const keyed = inputs
    .map((input) => ({ input, dedupeKey: safeDedupeKey(input) }))
    .filter((r): r is { input: SourcedLocationInput; dedupeKey: string } => r.dedupeKey !== null);

  const uniqueKeys = [...new Set(keyed.map((r) => r.dedupeKey))];
  const lookups = await Promise.all(
    uniqueKeys.map(async (key) => [key, await getSourcedLocation(key)] as const),
  );
  const existingIds = new Map<string, string>();
  for (const [key, doc] of lookups) {
    if (doc) existingIds.set(key, doc.id);
  }

  const seenInBatch = new Set<string>();
  return keyed.map(({ input, dedupeKey }) => {
    const existingId = existingIds.get(dedupeKey);
    let tag: SourceLocationTag;
    if (existingId) {
      tag = 'EXISTS';
    } else if (seenInBatch.has(dedupeKey)) {
      tag = 'DUPLICATE';
    } else {
      tag = 'NEW';
    }
    seenInBatch.add(dedupeKey);
    return { ...input, dedupeKey, tag, existingId };
  });
}

export type FetchAndParseResult =
  | { kind: Exclude<SourceUrlKind, 'unknown'>; results: TaggedSourceLocation[] }
  | { kind: 'unknown'; error: string };

/**
 * Classify a pasted URL (SpotHero, Parkopedia, or one of the 14 other
 * connected sources) and route to the matching fetch+parse+map flow, then
 * dedupe-tag the results. Fails closed — never throws; an unrecognized URL
 * or a fetch/parse failure both come back as `{ kind: 'unknown', error }`
 * for the server action to relay to the admin.
 */
export async function fetchAndParseSourceUrl(url: string): Promise<FetchAndParseResult> {
  const kind = classifySourceUrl(url);
  try {
    let inputs: SourcedLocationInput[];
    switch (kind) {
      case 'spothero-listing':
        inputs = await fetchSpotHeroListing(url);
        break;
      case 'spothero-facility':
        inputs = await fetchSpotHeroFacility(url);
        break;
      case 'parkopedia-listing':
        inputs = await fetchParkopediaListing(url);
        break;
      case 'parkopedia-location':
        inputs = await fetchParkopediaLocation(url);
        break;
      case 'miami-beach':
        inputs = await fetchMiamiBeach();
        break;
      case 'portmiami':
        inputs = await fetchPortMiami();
        break;
      case 'mia-airport':
        inputs = await fetchMiaAirport();
        break;
      case 'tamu':
        inputs = await fetchTamu();
        break;
      case 'umich':
        inputs = await fetchUmich();
        break;
      case 'ucdavis':
        inputs = await fetchUcdavis();
        break;
      case 'gatech':
        inputs = await fetchGatech();
        break;
      case 'sylvan':
        inputs = await fetchSylvan();
        break;
      case 'ipark':
        inputs = await fetchIpark();
        break;
      case 'securehi':
        inputs = await fetchSecurehi();
        break;
      case 'palmetto':
        inputs = await fetchPalmetto();
        break;
      case 'gachas':
        inputs = await fetchGachas();
        break;
      case 'parkingo':
        inputs = await fetchParkingo();
        break;
      case 'parkwhiz':
        inputs = await fetchParkWhiz();
        break;
      default:
        return {
          kind: 'unknown',
          error: 'Unrecognized URL — expected a SpotHero, Parkopedia, or one of the 14 other connected-source URLs.',
        };
    }
    return { kind, results: await tagAgainstFirestore(inputs) };
  } catch (err) {
    return { kind: 'unknown', error: err instanceof Error ? err.message : String(err) };
  }
}
