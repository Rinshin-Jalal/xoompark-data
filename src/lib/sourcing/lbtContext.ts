// Pure LBT (Local Business Tax) resolution — deliberately network- and
// Firestore-free (same split as every other sourcing module) so it runs
// under plain `node --experimental-strip-types`.
//
// Recon (2026-09-04, live): MD_LandInformation layer 23 carries one point
// per business-tax receipt: FOLIO (DASHED — XX-XXXX-XXX-XXXX, unlike the
// parcel layer's 13 bare digits), BUSNAME, OWNERNAME, PHONENO, EMAIL,
// CLASSCODE/CLASSDESC, ACCSTATUS (Active/Closed), YEAR, business address.
// 467 receipts countywide have PARKING in the business name.
//
// Trap found in testing: a parcel's non-parking tenants (salons, espresso
// bars, law offices) hold LBT receipts at the same folio — a bare folio
// join returns them too. Only parking-named businesses may become
// lbtContext; everything else is an honest miss. No spatial fallback: an
// operator's receipt sits at their office address, not at each lot.
import type { SourcedParkingLocation } from './types.ts';

export type LbtContext = NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['business_license']>;

export const LBT_LAYER_URL =
  'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/23/query';

const OUT_FIELDS = [
  'FOLIO', 'BUSNAME', 'OWNERNAME', 'PHONENO', 'EMAIL', 'BUSADDR', 'BUSADDR2', 'BUSCITY',
  'BUSSTATE', 'ZIPCODE', 'CLASSCODE', 'CLASSDESC', 'ACCSTATUS', 'YEAR',
].join(',');

/** A business name that plausibly operates parking. */
const PARKING_BUSINESS = /PARKING|VALET|GARAGE|\bLOT\b/i;

export interface LbtRecord {
  FOLIO?: string | null;
  BUSNAME?: string | null;
  OWNERNAME?: string | null;
  PHONENO?: string | null;
  EMAIL?: string | null;
  BUSADDR?: string | null;
  BUSADDR2?: string | null;
  BUSCITY?: string | null;
  BUSSTATE?: string | null;
  ZIPCODE?: string | null;
  CLASSCODE?: string | null;
  CLASSDESC?: string | null;
  ACCSTATUS?: string | null;
  YEAR?: number | null;
}

/** 13-digit parcel folio -> LBT's dashed form (XX-XXXX-XXX-XXXX). */
export function dashFolio(folio: string): string {
  return folio.length === 13
    ? `${folio.slice(0, 2)}-${folio.slice(2, 6)}-${folio.slice(6, 9)}-${folio.slice(9)}`
    : folio;
}

/** Exact query URL for all LBT receipts on one folio — the audit trail. */
export function buildLbtQueryUrl(folio: string): string {
  const params = new URLSearchParams({
    f: 'json', where: `FOLIO='${dashFolio(folio)}'`, outFields: OUT_FIELDS,
    returnGeometry: 'false',
  });
  return `${LBT_LAYER_URL}?${params}`;
}

function isParkingBusiness(r: LbtRecord): boolean {
  return typeof r.BUSNAME === 'string' && PARKING_BUSINESS.test(r.BUSNAME);
}

/**
 * Pure pick: which receipt (if any) represents the lot's operator.
 * Parking-named only (tenant trap), then Active over Closed, then the
 * most recent receipt year. Returns null when no parking business holds
 * a receipt at this folio — an honest miss, never a tenant.
 */
export function pickLbtRecord(records: LbtRecord[]): LbtRecord | null {
  const parking = records.filter(isParkingBusiness);
  if (parking.length === 0) return null;
  return parking.sort((a, b) => {
    const active = (Number(b.ACCSTATUS === 'Active') - Number(a.ACCSTATUS === 'Active'));
    if (active !== 0) return active;
    return (b.YEAR ?? 0) - (a.YEAR ?? 0);
  })[0];
}

function joinBusinessAddress(r: LbtRecord): string | undefined {
  const parts = [r.BUSADDR, r.BUSADDR2, r.BUSCITY, r.BUSSTATE, r.ZIPCODE]
    .map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Map a picked receipt to the stored context block. */
export function toLbtContext(record: LbtRecord, sourceUrl: string, now: string): LbtContext {
  const ctx: LbtContext = {
    businessName: clean(record.BUSNAME) ?? 'unknown',
    folio: clean(record.FOLIO) ?? 'unknown',
    sourceUrl,
    checkedAt: now,
  };
  const owner = clean(record.OWNERNAME); if (owner) ctx.ownerName = owner;
  const phone = clean(record.PHONENO); if (phone) ctx.phone = phone;
  const email = clean(record.EMAIL); if (email) ctx.email = email;
  const addr = joinBusinessAddress(record); if (addr) ctx.businessAddress = addr;
  const cc = clean(record.CLASSCODE); if (cc) ctx.classCode = cc;
  const cd = clean(record.CLASSDESC); if (cd) ctx.classDesc = cd;
  const st = clean(record.ACCSTATUS); if (st) ctx.accountStatus = st;
  if (typeof record.YEAR === 'number') ctx.receiptYear = record.YEAR;
  return ctx;
}

/** Full pure resolution: all receipts on the folio in, context out (or null). */
export function resolveLbtContext(records: LbtRecord[], folio: string, now: string): LbtContext | null {
  const pick = pickLbtRecord(records);
  if (!pick) return null;
  return toLbtContext(pick, buildLbtQueryUrl(folio), now);
}
