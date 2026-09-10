// Plain assert-based test runnable with `node --experimental-strip-types`.
// Fixtures are trimmed from REAL query responses captured 2026-09-04 against
// MD_LandInformation layers 26 (Parcels) and 24 (Property) using prod lot
// coordinates — the four cases the recon actually hit: clean point-in-polygon
// (Panorama Tower), reference-folio point hit (Citigroup Center), ROW-miss
// zero-hit (Miami Central Retail Garage), and a multi-candidate nearest
// match (244 NE 3rd St / Vizcayne).
import assert from 'node:assert/strict';
import { buildEnvelopeQueryUrl, buildPointQueryUrl, pickParcel, resolveParcelContext, type ArcgisQueryResponse } from '../parcelContext.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const NOW = '2026-09-04T00:00:00.000Z';

// ── fixtures (real responses, geometry trimmed to what the code reads) ──────

// Point-in-polygon hit on Panorama Tower's parcel (1100 Brickell Bay Dr).
const POINT_HIT: ArcgisQueryResponse = {
  features: [{
    attributes: {
      FOLIO: '0102100301130', TRUE_OWNER1: 'TWJ 1101 LLC', DOR_CODE_CUR: '1229',
      DOR_DESC: 'MIXED USE-STORE/RESIDENTIAL', PRIMARY_ZONE: '6400', CONDO_FLAG: 'N',
      LOT_SIZE: 12345.0, TRUE_SITE_ADDR: '1100 BRICKELL BAY DR',
      TRUE_MAILING_ADDR1: '1234 BRICKELL AVE', TRUE_MAILING_CITY: 'MIAMI',
      TRUE_MAILING_STATE: 'FL', TRUE_MAILING_ZIP_CODE: '33131',
    },
  }],
};

// Point hit on a REFERENCE FOLIO (DOR 0000) — must fall through to the
// envelope fallback (Citigroup Center case).
const POINT_REFERENCE: ArcgisQueryResponse = {
  features: [{
    attributes: { FOLIO: '0131360790001', TRUE_OWNER1: 'REFERENCE ONLY', DOR_CODE_CUR: '0000', DOR_DESC: 'REFERENCE FOLIO', CONDO_FLAG: 'N' },
  }],
};

// ROW miss — point sits on the street, no parcel contains it.
const POINT_MISS: ArcgisQueryResponse = { features: [] };

// Envelope fallback candidates for the ROW miss (Miami Central Retail
// Garage: county office building ~30m away).
const ENV_COUNTY: ArcgisQueryResponse = {
  features: [{
    attributes: { FOLIO: '0141370700010', TRUE_OWNER1: 'MIAMI-DADE COUNTY', DOR_CODE_CUR: '8613', DOR_DESC: 'COUNTY : OFFICE BUILDING', CONDO_FLAG: 'N', TRUE_SITE_ADDR: '155 NW 3 ST' },
    geometry: { x: -80.1971, y: 25.7772 }, // ~30m from the query point
  }],
};

// Two candidates at nearly the same distance, different owners (Vizcayne:
// retail LLC vs master association) — the tie-break/ambiguity case.
const ENV_VIZCAYNE: ArcgisQueryResponse = {
  features: [
    {
      attributes: { FOLIO: '0101100001010', TRUE_OWNER1: 'VIZCAYNE RETAIL LLC', DOR_CODE_CUR: '1117', DOR_DESC: 'STORE : COMMERCIAL', CONDO_FLAG: 'N', TRUE_SITE_ADDR: '244 BISCAYNE BLVD' },
      geometry: { x: -80.18905, y: 25.77690 },
    },
    {
      attributes: { FOLIO: '0101100001020', TRUE_OWNER1: 'VIZCAYNE MASTER ASSOCIATION INC', DOR_CODE_CUR: '0951', DOR_DESC: 'COMMON AREAS', CONDO_FLAG: 'N', TRUE_SITE_ADDR: '244 BISCAYNE BLVD' },
      geometry: { x: -80.18904, y: 25.77691 }, // ~0.5m farther than the first — a genuine tie
    },
  ],
};

// A parking-DOR candidate further away must beat a closer non-parking one.
const ENV_PARKING_FAR: ArcgisQueryResponse = {
  features: [
    {
      attributes: { FOLIO: '0101100001010', TRUE_OWNER1: 'OFFICE TOWER LLC', DOR_CODE_CUR: '1117', DOR_DESC: 'STORE : COMMERCIAL', CONDO_FLAG: 'N' },
      geometry: { x: -80.18900, y: 25.77685 }, // ~10m
    },
    {
      attributes: { FOLIO: '0101100009999', TRUE_OWNER1: 'GARAGE OWNER LLC', DOR_CODE_CUR: '0026', DOR_DESC: 'PARKING GARAGE', CONDO_FLAG: 'N' },
      geometry: { x: -80.18940, y: 25.77720 }, // ~50m
    },
  ],
};

// ── tests ────────────────────────────────────────────────────────────────────

test('point-in-polygon hit: exact parcel, no distance, not ambiguous', () => {
  const ctx = resolveParcelContext(POINT_HIT, null, 25.7631139, -80.190415, NOW);
  assert.ok(ctx);
  assert.equal(ctx.folio, '0102100301130');
  assert.equal(ctx.ownerOfRecord, 'TWJ 1101 LLC');
  assert.equal(ctx.matchMethod, 'point-in-polygon');
  assert.equal(ctx.matchDistanceM, null);
  assert.equal(ctx.ambiguous, undefined);
  assert.equal(ctx.dorCode, '1229');
  assert.equal(ctx.lotSizeSqft, 12345);
  assert.equal(ctx.ownerMailingAddress, '1234 BRICKELL AVE, MIAMI, FL, 33131');
  assert.ok(ctx.sourceUrl.startsWith('https://gisweb.miamidade.gov/'));
  assert.ok(ctx.sourceUrl.includes('esriGeometryPoint'));
});

test('reference-folio point hit falls through to the envelope fallback', () => {
  const ctx = resolveParcelContext(POINT_REFERENCE, ENV_COUNTY, 25.7770313, -80.1970147, NOW);
  assert.ok(ctx);
  assert.equal(ctx.ownerOfRecord, 'MIAMI-DADE COUNTY');
  assert.equal(ctx.matchMethod, 'nearest');
  assert.ok(typeof ctx.matchDistanceM === 'number');
  assert.ok(ctx.sourceUrl.includes('esriGeometryEnvelope'));
});

test('ROW miss (zero point hits) resolves via nearest candidate', () => {
  const ctx = resolveParcelContext(POINT_MISS, ENV_COUNTY, 25.7770313, -80.1970147, NOW);
  assert.ok(ctx);
  assert.equal(ctx.folio, '0141370700010');
  assert.equal(ctx.matchMethod, 'nearest');
  assert.ok((ctx.matchDistanceM ?? 0) > 10 && (ctx.matchDistanceM ?? 0) < 60);
});

test('near-tie between different owners flags ambiguous', () => {
  const pick = pickParcel(POINT_MISS, ENV_VIZCAYNE, 25.776841, -80.189007);
  assert.ok(pick);
  assert.equal(pick.method, 'nearest');
  assert.equal(pick.ambiguous, true);
  // nearest of the two wins (VIZCAYNE RETAIL LLC is marginally closer)
  assert.equal(String(pick.attrs.TRUE_OWNER1), 'VIZCAYNE RETAIL LLC');
});

test('parking-DOR candidate beats a closer non-parking candidate', () => {
  const pick = pickParcel(POINT_MISS, ENV_PARKING_FAR, 25.776841, -80.189007);
  assert.ok(pick);
  assert.equal(String(pick.attrs.DOR_CODE_CUR), '0026');
  assert.equal(String(pick.attrs.TRUE_OWNER1), 'GARAGE OWNER LLC');
});

test('no point hit + no envelope candidates -> null (honest miss)', () => {
  assert.equal(resolveParcelContext(POINT_MISS, { features: [] }, 25.77, -80.19, NOW), null);
  assert.equal(resolveParcelContext({ features: [] }, null, 25.77, -80.19, NOW), null);
});

test('query URLs carry the audit-relevant params', () => {
  assert.ok(buildPointQueryUrl(25.76, -80.19).includes('MapServer/26/query'));
  assert.ok(buildEnvelopeQueryUrl(25.76, -80.19).includes('MapServer/24/query'));
  // where-clause is percent-encoded by URLSearchParams — check decoded
  assert.ok(decodeURIComponent(buildEnvelopeQueryUrl(25.76, -80.19)).includes("CONDO_FLAG='N'"));
});

console.log('\nall parcelContext tests passed');
