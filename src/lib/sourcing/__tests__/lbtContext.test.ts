// Plain assert-based test runnable with `node --experimental-strip-types`.
// Fixtures trimmed from REAL LBT layer-23 responses captured 2026-09-04 —
// including the tenant trap (non-parking businesses at the same folio).
import assert from 'node:assert/strict';
import { buildLbtQueryUrl, dashFolio, pickLbtRecord, resolveLbtContext, type LbtRecord } from '../lbtContext.ts';

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

// Real receipt shape (1ST PARKING USA INC, folio 01-4139-021-1310).
const PARKING_RECEIPT: LbtRecord = {
  FOLIO: '01-4139-021-1310', BUSNAME: '1ST PARKING USA INC', OWNERNAME: '1ST PARKING USA INC',
  PHONENO: '3058562255', EMAIL: null, BUSADDR: '1401 BRICKELL AVE', BUSADDR2: null,
  BUSCITY: 'MIAMI', BUSSTATE: 'FL', ZIPCODE: '33131', CLASSCODE: '213',
  CLASSDESC: 'Service business/multiple service business', ACCSTATUS: 'Active', YEAR: 2025,
};

// The tenant trap: same folio, non-parking businesses (real recon hits).
const TENANT_A: LbtRecord = { FOLIO: '01-0210-030-1330', BUSNAME: 'GEMMA EXECUTIVE COACHING LLC', PHONENO: '6173970110', ACCSTATUS: 'Active', YEAR: 2025 };
const TENANT_B: LbtRecord = { FOLIO: '01-0210-030-1330', BUSNAME: 'CREMA GOURMET ESPRESSO BAR', PHONENO: '786-271-9314', ACCSTATUS: 'Active', YEAR: 2025 };

test('dashFolio: 13 bare digits -> LBT dashed form', () => {
  assert.equal(dashFolio('0141390211310'), '01-4139-021-1310');
  assert.equal(dashFolio('0132300170310'), '01-3230-017-0310');
  // non-13-char input passes through untouched
  assert.equal(dashFolio('01-4139-021-1310'), '01-4139-021-1310');
});

test('parking receipt picked over tenants at the same folio', () => {
  const pick = pickLbtRecord([TENANT_A, PARKING_RECEIPT, TENANT_B]);
  assert.equal(pick?.BUSNAME, '1ST PARKING USA INC');
});

test('tenant-only folio -> null (honest miss, never a salon as operator)', () => {
  assert.equal(pickLbtRecord([TENANT_A, TENANT_B]), null);
  assert.equal(resolveLbtContext([TENANT_A], '0102100301330', NOW), null);
});

test('active beats closed; newer year breaks ties', () => {
  const closed2025: LbtRecord = { ...PARKING_RECEIPT, ACCSTATUS: 'Closed', YEAR: 2025 };
  const active2023: LbtRecord = { ...PARKING_RECEIPT, BUSNAME: 'OLD PARKING LLC', ACCSTATUS: 'Active', YEAR: 2023 };
  assert.equal(pickLbtRecord([closed2025, active2023])?.ACCSTATUS, 'Active');
  const active2024: LbtRecord = { ...PARKING_RECEIPT, BUSNAME: 'NEWER PARKING LLC', ACCSTATUS: 'Active', YEAR: 2024 };
  assert.equal(pickLbtRecord([active2023, active2024])?.BUSNAME, 'NEWER PARKING LLC');
});

test('full context mapping: phone, address, class, status, year, audit URL', () => {
  const ctx = resolveLbtContext([PARKING_RECEIPT], '0141390211310', NOW);
  assert.ok(ctx);
  assert.equal(ctx.businessName, '1ST PARKING USA INC');
  assert.equal(ctx.phone, '3058562255');
  assert.equal(ctx.businessAddress, '1401 BRICKELL AVE, MIAMI, FL, 33131');
  assert.equal(ctx.classCode, '213');
  assert.equal(ctx.accountStatus, 'Active');
  assert.equal(ctx.receiptYear, 2025);
  assert.equal(ctx.folio, '01-4139-021-1310');
  assert.ok(ctx.source_url.includes('MapServer/23/query'));
  assert.ok(decodeURIComponent(ctx.source_url).includes("FOLIO='01-4139-021-1310'"));
});

test('valet/garage names count as parking businesses', () => {
  assert.ok(pickLbtRecord([{ BUSNAME: 'VALET PARKING 4 YOU', ACCSTATUS: 'Active' }]));
  assert.ok(pickLbtRecord([{ BUSNAME: 'SUNSET GARAGE CORP', ACCSTATUS: 'Active' }]));
  assert.ok(pickLbtRecord([{ BUSNAME: 'PRO PARKING LOT SERVICES CORP', ACCSTATUS: 'Active' }]));
});

console.log('\nall lbtContext tests passed');
