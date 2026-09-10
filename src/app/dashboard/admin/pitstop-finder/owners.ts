import 'server-only';
import type { MetroCode } from '@/lib/types';

// v2 priority #1 from scripts/finder.py: parcel/owner join for owner_direct_candidate rows.
// Only Miami-Dade has a confirmed free, no-auth parcel API with owner fields — verified by
// hitting it directly. San Diego's SanGIS layer documents the same owner fields but the
// obvious public mirror was WAF-blocked when checked; kept here best-effort, fails closed.
// San Francisco has no lookup at all: DataSF's assessor roll has no owner field by CA law.

export interface OwnerInfo {
  ownerName: string | null;
  owner_mailing_addressAddress: string | null;
  folio: string | null;
  land_use_code: string | null;
  zoning_code: string | null;
}

const EMPTY: OwnerInfo = { ownerName: null, owner_mailing_addressAddress: null, folio: null, land_use_code: null, zoning_code: null };

async function arcgisPointQuery(url: string, lat: number, lng: number, outFields: string[]): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    returnGeometry: 'false',
  });
  const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const json = await res.json();
  return json.features?.[0]?.attributes ?? null;
}

async function lookupMiamiOwner(lat: number, lng: number): Promise<OwnerInfo> {
  const attrs = await arcgisPointQuery(
    'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query',
    lat, lng,
    ['TRUE_OWNER1', 'TRUE_MAILING_ADDR1', 'TRUE_MAILING_CITY', 'TRUE_MAILING_STATE', 'TRUE_MAILING_ZIP_CODE', 'FOLIO', 'DOR_DESC', 'PRIMARY_ZONE'],
  );
  if (!attrs) return EMPTY;
  const mailing = [attrs.TRUE_MAILING_ADDR1, attrs.TRUE_MAILING_CITY, attrs.TRUE_MAILING_STATE, attrs.TRUE_MAILING_ZIP_CODE]
    .filter(Boolean).join(', ');
  return {
    ownerName: (attrs.TRUE_OWNER1 as string) || null,
    owner_mailing_addressAddress: mailing || null,
    folio: (attrs.FOLIO as string) || null,
    land_use_code: (attrs.DOR_DESC as string) || null,
    zoning_code: (attrs.PRIMARY_ZONE as string) || null,
  };
}

async function lookupSanDiegoOwner(lat: number, lng: number): Promise<OwnerInfo> {
  const attrs = await arcgisPointQuery(
    'https://geo.sandag.org/server/rest/services/Hosted/Parcels/FeatureServer/0/query',
    lat, lng,
    ['OWN_NAME1', 'OWN_ADDR1', 'OWN_ADDR2', 'OWN_ZIP', 'APN', 'NUCLEUS_USE_CD', 'NUCLEUS_ZONE_CD'],
  );
  if (!attrs) return EMPTY;
  const mailing = [attrs.OWN_ADDR1, attrs.OWN_ADDR2, attrs.OWN_ZIP].filter(Boolean).join(', ');
  return {
    ownerName: (attrs.OWN_NAME1 as string) || null,
    owner_mailing_addressAddress: mailing || null,
    folio: (attrs.APN as string) || null,
    land_use_code: (attrs.NUCLEUS_USE_CD as string) || null,
    zoning_code: (attrs.NUCLEUS_ZONE_CD as string) || null,
  };
}

const LOOKUPS: Partial<Record<MetroCode, (lat: number, lng: number) => Promise<OwnerInfo>>> = {
  miami: lookupMiamiOwner,
  sd: lookupSanDiegoOwner,
};

export async function lookupOwner(metro_id: MetroCode, lat: number, lng: number): Promise<OwnerInfo> {
  const fn = LOOKUPS[metro_id];
  if (!fn) return EMPTY;
  try {
    return await fn(lat, lng);
  } catch {
    return EMPTY;
  }
}
