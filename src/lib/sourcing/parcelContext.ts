// Pure parcel-resolution logic for the Miami-Dade Property Appraiser
// enrichment (parcelContext) — deliberately network- and Firestore-free
// (same split as types.ts vs store.ts, geoContextParse.ts vs geoContext.ts)
// so it runs under plain `node --experimental-strip-types`.
//
// Recon (2026-09-04, live against prod coordinates): the county's
// MD_LandInformation MapServer carries everything on two layers —
//   26 "Parcels @ PaParcel"  (polygons; FOLIO + owner + DOR + zone + values)
//   24 "Property @ PaGis"    (points;   same attributes, one per folio)
// Two traps found in testing, both handled here:
//   1. ROW miss — listing coords often sit on the street/right-of-way,
//      outside every parcel polygon (3 of 5 real test coords missed).
//      Fallback: nearest non-condo, non-reference property point within ~55m.
//   2. Condo flood — an envelope query in a dense area returns 1000+ condo
//      unit folios (exceededTransferLimit). The fallback query filters
//      CONDO_FLAG='N' + DOR_CODE_CUR<>'0000' (reference folios) + not
//      cancelled, which kills the flood.
//      // ponytail: a condo-MASTER folio flagged Y is unreachable via the
//      // fallback — point-in-polygon still catches those; add a second
//      // unfiltered tier if that gap measurably matters.
import type { SourcedParkingLocation } from './types.ts';

export type ParcelContext = NonNullable<SourcedParkingLocation['parcelContext']>;

export const PARCELS_LAYER_URL =
  'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query';
export const PROPERTY_LAYER_URL =
  'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/24/query';

const OUT_FIELDS = [
  'FOLIO', 'TRUE_OWNER1', 'TRUE_OWNER2', 'TRUE_SITE_ADDR', 'TRUE_SITE_CITY', 'TRUE_SITE_ZIP_CODE',
  'TRUE_MAILING_ADDR1', 'TRUE_MAILING_ADDR2', 'TRUE_MAILING_ADDR3', 'TRUE_MAILING_CITY',
  'TRUE_MAILING_STATE', 'TRUE_MAILING_ZIP_CODE', 'DOR_CODE_CUR', 'DOR_DESC', 'PRIMARY_ZONE',
  'LOT_SIZE', 'CONDO_FLAG', 'PARENT_FOLIO',
].join(',');

/** DOR codes where the parcel itself IS parking: 0026 garage, 0027 lot. */
const PARKING_DOR_CODES = new Set(['0026', '0027']);

/** ~55m in degrees at Miami's latitude — the fallback search radius. */
const ENVELOPE_HALF_DEG = 0.0005;
/** Beyond this, a nearest-match is flagged ambiguous for human review. */
const AMBIGUOUS_DISTANCE_M = 40;

export interface ArcgisFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
}

export interface ArcgisQueryResponse {
  features?: ArcgisFeature[];
}

/** Exact query URL for the parcel polygon containing (lat, lng) — the audit trail. */
export function buildPointQueryUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    f: 'json', where: '1=1', outFields: OUT_FIELDS,
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false',
  });
  return `${PARCELS_LAYER_URL}?${params}`;
}

/** Fallback query URL: non-condo, non-reference, non-cancelled property points near (lat, lng). */
export function buildEnvelopeQueryUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    f: 'json',
    where: "CONDO_FLAG='N' AND CANCEL_FLAG<>'Y' AND DOR_CODE_CUR<>'0000'",
    outFields: OUT_FIELDS,
    geometry: JSON.stringify({
      xmin: lng - ENVELOPE_HALF_DEG, ymin: lat - ENVELOPE_HALF_DEG,
      xmax: lng + ENVELOPE_HALF_DEG, ymax: lat + ENVELOPE_HALF_DEG,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', outSR: '4326',
  });
  return `${PROPERTY_LAYER_URL}?${params}`;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isReference(a: Record<string, unknown>): boolean {
  return a.DOR_CODE_CUR === '0000' || a.TRUE_OWNER1 === 'REFERENCE ONLY';
}

function isUsable(a: Record<string, unknown>): boolean {
  return typeof a.FOLIO === 'string' && a.FOLIO.length > 0 && !isReference(a);
}

export interface ParcelPick {
  attrs: Record<string, unknown>;
  method: 'point-in-polygon' | 'nearest';
  distanceM: number | null;
  ambiguous: boolean;
}

/**
 * Pure decision: which parcel (if any) does this coordinate belong to.
 * 1. Point-in-polygon on the parcel layer — exact when it hits a real folio.
 *    (Stacked parcels: prefer parking DOR codes, then first usable.)
 * 2. Fallback: nearest non-condo property point, parking DOR codes preferred
 *    over everything else at any distance, then pure nearest.
 * Ambiguous when the nearest match is >40m out or two candidates tie.
 */
export function pickParcel(
  pointResp: ArcgisQueryResponse,
  envelopeResp: ArcgisQueryResponse | null,
  lat: number,
  lng: number,
): ParcelPick | null {
  const pointHits = (pointResp.features ?? [])
    .map((f) => f.attributes ?? {})
    .filter(isUsable);
  if (pointHits.length > 0) {
    const best = pointHits.find((a) => PARKING_DOR_CODES.has(String(a.DOR_CODE_CUR))) ?? pointHits[0];
    return { attrs: best, method: 'point-in-polygon', distanceM: null, ambiguous: pointHits.length > 1 };
  }

  const candidates = (envelopeResp?.features ?? []).filter((f) => isUsable(f.attributes ?? {}));
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((f) => ({
      attrs: f.attributes ?? {},
      d: f.geometry?.y !== undefined && f.geometry?.x !== undefined
        ? haversineM(lat, lng, f.geometry.y, f.geometry.x)
        : Infinity,
    }))
    .sort((a, b) => a.d - b.d);

  // A parking-zoned parcel wins outright regardless of distance order —
  // a garage/lot folio next door beats an office tower on top of us.
  const parking = ranked.find((r) => PARKING_DOR_CODES.has(String(r.attrs.DOR_CODE_CUR)));
  const best = parking ?? ranked[0];
  const runnerUp = ranked.find((r) => r.attrs.FOLIO !== best.attrs.FOLIO);
  const tie = !!runnerUp && Math.abs(runnerUp.d - best.d) < 2 && runnerUp.attrs.TRUE_OWNER1 !== best.attrs.TRUE_OWNER1;
  return {
    attrs: best.attrs,
    method: 'nearest',
    distanceM: Number.isFinite(best.d) ? Math.round(best.d) : null,
    ambiguous: best.d > AMBIGUOUS_DISTANCE_M || tie,
  };
}

function joinMailing(a: Record<string, unknown>): string | undefined {
  const parts = [a.TRUE_MAILING_ADDR1, a.TRUE_MAILING_ADDR2, a.TRUE_MAILING_ADDR3,
    a.TRUE_MAILING_CITY, a.TRUE_MAILING_STATE, a.TRUE_MAILING_ZIP_CODE]
    .map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

/** Map a picked parcel's ArcGIS attributes to the stored context block. */
export function toParcelContext(pick: ParcelPick, sourceUrl: string, now: string): ParcelContext {
  const a = pick.attrs;
  const site = [a.TRUE_SITE_ADDR, a.TRUE_SITE_CITY, a.TRUE_SITE_ZIP_CODE]
    .map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean).join(', ');
  const ctx: ParcelContext = {
    folio: String(a.FOLIO),
    ownerOfRecord: String(a.TRUE_OWNER1 ?? '').trim() || 'unknown',
    siteAddress: site || undefined,
    dorCode: a.DOR_CODE_CUR !== undefined && a.DOR_CODE_CUR !== null ? String(a.DOR_CODE_CUR) : undefined,
    dorDesc: typeof a.DOR_DESC === 'string' && a.DOR_DESC ? a.DOR_DESC : undefined,
    primaryZone: typeof a.PRIMARY_ZONE === 'string' && a.PRIMARY_ZONE ? a.PRIMARY_ZONE : undefined,
    lotSizeSqft: typeof a.LOT_SIZE === 'number' && a.LOT_SIZE > 0 ? a.LOT_SIZE : null,
    matchMethod: pick.method,
    matchDistanceM: pick.distanceM,
    sourceUrl,
    checkedAt: now,
  };
  const mailing = joinMailing(a);
  if (mailing) ctx.ownerMailingAddress = mailing;
  if (pick.ambiguous) ctx.ambiguous = true;
  return ctx;
}

/**
 * Full pure resolution: both query responses in, context block out. The
 * sourceUrl stored is whichever query actually produced the match (the
 * envelope URL when the fallback fired) — the audit trail points at the
 * evidence, not the attempt.
 */
export function resolveParcelContext(
  pointResp: ArcgisQueryResponse,
  envelopeResp: ArcgisQueryResponse | null,
  lat: number,
  lng: number,
  now: string,
): ParcelContext | null {
  const pick = pickParcel(pointResp, envelopeResp, lat, lng);
  if (!pick) return null;
  const url = pick.method === 'point-in-polygon' ? buildPointQueryUrl(lat, lng) : buildEnvelopeQueryUrl(lat, lng);
  return toParcelContext(pick, url, now);
}
