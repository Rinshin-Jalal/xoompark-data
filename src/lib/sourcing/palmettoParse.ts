// Pure parse/map logic for the Palmetto Parking adapter — deliberately
// network- and Firestore-free (same split as spotheroParse.ts) so it runs
// under plain `node --experimental-strip-types`, no 'server-only' guard.
import { slugifyCity } from '../citySlug.ts';
import type { SourcedLocationInput } from './types.ts';

export interface PalmettoPlacemark {
  /** Palmetto's own lot number (the KML <name>, e.g. "001"). */
  name: string;
  description?: string;
  lat?: number;
  lng?: number;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Pull every <Placemark> out of Palmetto's public Google My Maps KML export.
 * Each placemark: <name> = lot number, <description> = "ADDRESS - HOURS",
 * <coordinates> = "lng,lat,0". Verified against a real fetch of
 * google.com/maps/d/kml?mid=1dcQwPtyxqyoekOmCT-bj2H1pq3M&forcekml=1 on
 * 2026-08-25: 52 placemarks.
 */
export function extractPalmettoPlacemarks(kml: string): PalmettoPlacemark[] {
  const placemarks: PalmettoPlacemark[] = [];
  for (const pm of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const body = pm[1];
    const name = body.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim();
    if (!name) continue;
    const desc = body.match(/<description>([\s\S]*?)<\/description>/)?.[1];
    const coords = body.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1]?.trim();
    const [lng, lat] = coords ? coords.split(',').map(Number) : [];
    placemarks.push({
      name,
      description: desc ? stripCdata(desc).replace(/\s+/g, ' ').trim() : undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    });
  }
  return placemarks;
}

/**
 * Map one placemark to the store's input shape. The KML has no facility name
 * — only a lot number and an "ADDRESS - HOURS" description — so the address
 * doubles as the name (honest: there's nothing better), the lot number is the
 * sourceListingId, and the hours tail becomes hoursText.
 */
export function mapPlacemarkToInput(pm: PalmettoPlacemark): SourcedLocationInput | null {
  if (!pm.name) return null;

  const parts = pm.description?.split(/\s+-\s+/) ?? [];
  const address = parts[0]?.trim() || undefined;
  const hoursText = parts.slice(1).join(' - ').trim() || undefined;
  const name = address ?? `Palmetto lot ${pm.name}`;

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = { name: 'self-reported' };
  if (address) fieldProvenance.address = 'self-reported';
  if (pm.lat !== undefined) fieldProvenance.lat = 'self-reported';
  if (pm.lng !== undefined) fieldProvenance.lng = 'self-reported';
  if (hoursText) fieldProvenance.hoursText = 'self-reported';

  return {
    name,
    address,
    lat: pm.lat,
    lng: pm.lng,
    source: 'palmetto',
    sourceUrl: `https://palmettoparking.com/find-parking/#${slugifyCity(name)}`,
    sourceListingId: pm.name,
    hoursText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: pm,
  };
}

export interface PalmettoIngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Core ingest logic over already-parsed placemarks — same split as ingestFeaturedSpots. */
export async function ingestPalmettoPlacemarks(
  placemarks: PalmettoPlacemark[],
  upsert: (input: SourcedLocationInput) => Promise<unknown>,
): Promise<PalmettoIngestResult> {
  const errors: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const CONCURRENCY = 12;
  for (let i = 0; i < placemarks.length; i += CONCURRENCY) {
    const chunk = placemarks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((pm) => {
        const input = mapPlacemarkToInput(pm);
        if (!input) return Promise.resolve(null);
        return upsert(input);
      }),
    );
    chunk.forEach((pm, idx) => {
      const result = results[idx];
      if (result.status === 'rejected') {
        errors.push(`${pm.name ?? '?'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      } else if (result.value === null) {
        skipped++;
      } else {
        ingested++;
      }
    });
  }

  return { ingested, skipped, errors };
}