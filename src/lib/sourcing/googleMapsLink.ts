// Pure parsing of a Google Maps URL into a lat/lng pair — for the "no
// coordinates? look the address up on Google Maps and paste the link back
// in" fallback (docs/bdr-workflow.md's recording rules). No network call,
// Firestore-free, same split as locality.ts.
//
// A Google Maps place URL carries coordinates in more than one place, and
// they don't always agree:
//   .../place/69+SW+10th+St+Garage/@25.7649604,-80.1971072,17z/data=!3m1...
//     !4m6!3m5!1s0x...!8m2!3d25.7649556!4d-80.1945323!16s%2Fg%2F11f2gs_st_
// The `@lat,lng,zoom` segment is where the MAP VIEWPORT was centered when
// the link was generated — it can drift from the pin if the map was panned
// before sharing. The `!3d<lat>!4d<lng>` pair inside `data=` is the actual
// PLACE marker's coordinate — always prefer it when present. A plain share
// link (`?q=lat,lng` or `/@lat,lng`) has no `!3d!4d` pair, so that's the
// fallback.
export function parseGoogleMapsCoords(url: string): { lat: number; lng: number } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const placePin = trimmed.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (placePin) return { lat: Number(placePin[1]), lng: Number(placePin[2]) };

  const queryParam = trimmed.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (queryParam) return { lat: Number(queryParam[1]), lng: Number(queryParam[2]) };

  const viewportCenter = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (viewportCenter) return { lat: Number(viewportCenter[1]), lng: Number(viewportCenter[2]) };

  return null;
}
