// Plain assert-based test runnable with `node --experimental-strip-types`.
// Same style as dedupe.test.ts/merge.test.ts — only imports from
// addLocation.ts/types.ts (Firestore/'server-only'-free) so it runs without
// a DB or bundler.
import assert from 'node:assert/strict';
import { buildAddLocationInput, validateAddLocationInput, type AddLocationFormInput } from '../addLocation.ts';
import { computeDedupeKey, normalizeAddress } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// ── validation ───────────────────────────────────────────────────────────────

test('validateAddLocationInput: rejects missing name', () => {
  const result = validateAddLocationInput({ name: '   ', sourceUrl: 'https://example.com/lot' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.name);
});

test('validateAddLocationInput: rejects missing sourceUrl', () => {
  const result = validateAddLocationInput({ name: 'Lot A', sourceUrl: '' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.fieldErrors.sourceUrl, 'Source URL is required — where did you find this lot?');
});

test('validateAddLocationInput: rejects a string that is not a URL at all', () => {
  const result = validateAddLocationInput({ name: 'Lot A', sourceUrl: 'not a url' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.sourceUrl);
});

test('validateAddLocationInput: rejects a non-http/https protocol', () => {
  const result = validateAddLocationInput({ name: 'Lot A', sourceUrl: 'ftp://example.com/lot' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.sourceUrl);
});

test('validateAddLocationInput: rejects out-of-range lat/lng', () => {
  const result = validateAddLocationInput({
    name: 'Lot A',
    sourceUrl: 'https://example.com/lot',
    lat: '95',
    lng: '-200',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.lat);
    assert.ok(result.fieldErrors.lng);
  }
});

test('validateAddLocationInput: good input passes, blank optionals stay undefined', () => {
  const result = validateAddLocationInput({
    name: '  Lot A  ',
    sourceUrl: 'https://example.com/lot',
    address: '',
    lat: '',
    lng: '',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, 'Lot A');
    assert.equal(result.value.address, undefined);
    assert.equal(result.value.lat, undefined);
    assert.equal(result.value.lng, undefined);
  }
});

test('validateAddLocationInput: accepts http (not just https)', () => {
  const result = validateAddLocationInput({ name: 'Lot A', sourceUrl: 'http://example.com/lot' });
  assert.equal(result.ok, true);
});

// ── field provenance ─────────────────────────────────────────────────────────

test('buildAddLocationInput: only non-empty provided fields get verified provenance', () => {
  const raw: AddLocationFormInput = { name: 'Lot A', sourceUrl: 'https://example.com/lot', priceText: '$10/hr' };
  const validated = validateAddLocationInput(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const input = buildAddLocationInput(validated.value, raw);
  assert.equal(input.fieldProvenance?.name, 'verified');
  assert.equal(input.fieldProvenance?.priceText, 'verified');
  // never provided -> no entry at all, not 'unknown'
  assert.equal('address' in (input.fieldProvenance ?? {}), false);
  assert.equal('lat' in (input.fieldProvenance ?? {}), false);
  assert.equal('lng' in (input.fieldProvenance ?? {}), false);
  assert.equal('hoursText' in (input.fieldProvenance ?? {}), false);
  assert.equal('capacityText' in (input.fieldProvenance ?? {}), false);
});

test('buildAddLocationInput: sets source=manual, capturedBy=bdr-captured, status draft via upsert path', () => {
  const raw: AddLocationFormInput = { name: 'Lot A', sourceUrl: 'https://example.com/lot' };
  const validated = validateAddLocationInput(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const input = buildAddLocationInput(validated.value, raw);
  assert.equal(input.source, 'manual');
  assert.equal(input.capturedBy, 'bdr-captured');
  assert.equal(input.rawInput, raw);
});

test('buildAddLocationInput: carries the caller-supplied locality through untouched (Hunt tracker context, not derived from address text)', () => {
  const raw: AddLocationFormInput = {
    name: 'Lot A',
    sourceUrl: 'https://example.com/lot',
    address: '3401 N Miami Ave, Miami, FL 33127', // no "midtown"/"edgewater" substring
    locality: 'Edgewater / Midtown',
  };
  const validated = validateAddLocationInput(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const input = buildAddLocationInput(validated.value, raw);
  assert.equal(input.locality, 'Edgewater / Midtown');
});

test('buildAddLocationInput: carries clearance/ingress/tri-state fields through, so a fully-filled add-form record already satisfies the BDR checklist', () => {
  const raw: AddLocationFormInput = {
    name: 'Lot A',
    sourceUrl: 'https://example.com/lot',
    clearanceText: "6'8\"",
    ingressEgress: 'one-way in, separate exit',
    access247: true,
    fenced: false,
    lit: null, // "checked, couldn't tell" — a real recorded fact, not empty
  };
  const validated = validateAddLocationInput(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const input = buildAddLocationInput(validated.value, raw);
  assert.equal(input.clearanceText, "6'8\"");
  assert.equal(input.ingressEgress, 'one-way in, separate exit');
  assert.equal(input.access247, true);
  assert.equal(input.fenced, false);
  assert.equal(input.lit, null);
  assert.equal(input.fieldProvenance?.clearanceText, 'verified');
  assert.equal(input.fieldProvenance?.ingressEgress, 'verified');
  assert.equal(input.fieldProvenance?.access247, 'verified');
  assert.equal(input.fieldProvenance?.fenced, 'verified');
  assert.equal(input.fieldProvenance?.lit, 'verified', 'null (checked, could not tell) still counts as filled');
});

// ── dedupe-key stability ─────────────────────────────────────────────────────

test('dedupe stability: same name+address computed twice produces the same sourceListingId and id', () => {
  const raw: AddLocationFormInput = {
    name: 'Downtown Garage',
    sourceUrl: 'https://example.com/lot-1',
    address: '123 Main St, Miami, FL',
  };
  const validated = validateAddLocationInput(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const first = buildAddLocationInput(validated.value, raw);
  const second = buildAddLocationInput(validated.value, { ...raw, sourceUrl: 'https://example.com/lot-1-again' });

  assert.equal(first.sourceListingId, second.sourceListingId);

  const idFor = (i: typeof first) => {
    const normalizedAddress = i.normalizedAddress ?? (i.address ? normalizeAddress(i.address) : undefined);
    return computeDedupeKey({ source: i.source, sourceListingId: i.sourceListingId, normalizedAddress });
  };
  assert.equal(idFor(first), idFor(second));
});

test('dedupe stability: blank address falls back to slugifying name alone', () => {
  const raw: AddLocationFormInput = { name: 'Lot Without Address', sourceUrl: 'https://example.com/lot-2' };
  const validated = validateAddLocationInput(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const input = buildAddLocationInput(validated.value, raw);
  assert.equal(input.sourceListingId, 'lot-without-address');
});

console.log('\nall addLocation tests passed');
