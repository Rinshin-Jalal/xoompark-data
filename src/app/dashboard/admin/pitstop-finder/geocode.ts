import 'server-only';

// Reverse-geocodes a site's lat/lng into a street address - OSM parking
// nodes essentially never carry one, so without this every row is only
// identifiable by raw coordinates. Same server-side key and cost-scoping
// conventions as hours.ts: owner-direct candidates only (see enrichment.ts).

let warnedAboutApiError = false;

export async function lookupAddress(lat: number, lng: number): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`,
      { signal: AbortSignal.timeout(8_000) },
    ).then((r) => r.json());
    if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS' && !warnedAboutApiError) {
      warnedAboutApiError = true; // log once per server lifetime, not once per site
      console.error('[pitstop-finder/geocode] Geocoding API error (will keep failing silently):', res.status, res.error_message);
    }
    return res.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}
