import 'server-only';

// v2 layer: Places fallback for the closed-at-night flag, for owner_direct_candidate
// rows OSM didn't tag with opening_hours (the large majority — OSM only had it on 2 of
// 479 Miami sites when this was built). Costs real money per call (Nearby Search +
// Place Details), so it's scoped tight: candidates only, and only when OSM came back
// null. Uses GOOGLE_MAPS_API_KEY, a dedicated server-side key (Places API only,
// unrestricted by app since Cloud Run has no stable outbound IP to restrict by) — NOT
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, which is HTTP-referrer restricted for browser use and
// confirmed (via a live REQUEST_DENIED) to not work for server-to-server calls.

interface PlacesPeriod {
  open: { day: number; time: string };
  close?: { day: number; time: string };
}

function timeToMinutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
}

// Same night-window-overlap idea as the OSM opening_hours parser in lib.ts, just fed
// from Google's structured {day, time} periods instead of a raw string.
function isOpenDuringNight(periods: PlacesPeriod[]): boolean {
  const NIGHT_START = 22 * 60, NIGHT_END = 30 * 60;
  for (const p of periods) {
    if (!p.close) return true; // no close time = open 24 hours
    const start = p.open.day * 1440 + timeToMinutes(p.open.time);
    let end = p.close.day * 1440 + timeToMinutes(p.close.time);
    if (end <= start) end += 7 * 1440; // wraps into the next week (e.g. Sat night -> Sun)
    for (const shift of [-7 * 1440, 0, 7 * 1440]) {
      for (let day = 0; day < 7; day++) {
        const dayNightStart = day * 1440 + NIGHT_START;
        const dayNightEnd = day * 1440 + NIGHT_END;
        if (start + shift < dayNightEnd && end + shift > dayNightStart) return true;
      }
    }
  }
  return false;
}

export interface HoursResult {
  is_closed_at_night: boolean;
  hours_text: string | null;
}

let warnedAboutApiError = false;

export async function lookupClosedAtNight(lat: number, lng: number): Promise<HoursResult | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const nearby = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=60&type=parking&key=${key}`,
      { signal: AbortSignal.timeout(8_000) },
    ).then((r) => r.json());
    if (nearby.status !== 'OK' && nearby.status !== 'ZERO_RESULTS' && !warnedAboutApiError) {
      warnedAboutApiError = true; // log once per server lifetime, not once per site
      console.error('[pitstop-finder/hours] Places API error (will keep failing silently):', nearby.status, nearby.error_message);
    }
    const placeId = nearby.results?.[0]?.place_id;
    if (!placeId) return null;

    const details = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours&key=${key}`,
      { signal: AbortSignal.timeout(8_000) },
    ).then((r) => r.json());
    const opening_hours = details.result?.opening_hours;
    const periods: PlacesPeriod[] | undefined = opening_hours?.periods;
    if (!periods || periods.length === 0) return null;

    return {
      is_closed_at_night: !isOpenDuringNight(periods),
      hours_text: Array.isArray(opening_hours.weekday_text) ? opening_hours.weekday_text.join('; ') : null,
    };
  } catch {
    return null;
  }
}
