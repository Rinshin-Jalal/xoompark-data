// Plain assert-based test runnable with `node --experimental-strip-types`.
// Fixtures trimmed from the REAL facility 103525 payload captured 2026-09-04
// (redemptionInstructions: plate-match + camera-recognize + drive-out;
// amenities: self-park/covered/touchless; restrictions: height + plate line).
import assert from 'node:assert/strict';
import { deriveGateType, extractGateClaims, toGateEvidence, type GateEvidenceSource } from '../gateEvidence.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const REAL_103525: GateEvidenceSource = {
  redemptionInstructions: [
    { text: 'Make sure your license plate matches the plate on your Parking Pass. Failure to do so may result in a ticket or tow.' },
    { text: 'Just drive in. Our cameras will recognize your license plate. You may park anywhere that doesn’t say “Reserved”.' },
    { text: 'Simply drive out when you’re ready to go!' },
  ],
  amenities: [
    { type: 'self-park' }, { type: 'covered-parking' }, { type: 'touchless' },
  ],
  restrictions: ["Height Restriction: 6' 9\"", 'License plate on reservation must match the license plate used for validation.'],
};

test('real payload: all three instruction sentences kept verbatim + gate amenities + plate restriction', () => {
  const claims = extractGateClaims(REAL_103525);
  assert.equal(claims.length, 6); // 3 instructions + 2 gate amenities + 1 plate restriction
  assert.ok(claims[1].includes('cameras will recognize your license plate'));
  assert.ok(claims.includes('amenity: self-park'));
  assert.ok(claims.includes('amenity: touchless'));
  assert.ok(claims.some((c) => c.startsWith('License plate on reservation')));
  // non-gate amenities and non-plate restrictions are dropped
  assert.ok(!claims.includes('amenity: covered-parking'));
  assert.ok(!claims.some((c) => c.startsWith('Height Restriction')));
});

test('real payload: camera/plate text derives lpr', () => {
  const ev = toGateEvidence(REAL_103525, 'https://spothero.com/facility/103525/x', '2026-09-04T00:00:00.000Z');
  assert.ok(ev);
  assert.equal(ev.derivedGateType, 'lpr');
  assert.equal(ev.source_url, 'https://spothero.com/facility/103525/x');
});

test('drive-in only (no plate/camera text) stays a claim, derives nothing', () => {
  const source_name: GateEvidenceSource = {
    redemptionInstructions: [{ text: 'Just drive in and pick any open spot. Drive out when ready.' }],
    amenities: [{ type: 'self-park' }],
  };
  const ev = toGateEvidence(source, 'u', 'now');
  assert.ok(ev);
  assert.equal(ev.derivedGateType, undefined); // suggestive of gateless, NOT explicit
  assert.equal(ev.claims.length, 2);
});

test('attendant/valet amenities become claims but derive nothing', () => {
  const claims = extractGateClaims({ amenities: [{ type: 'attendant' }, { type: 'valet' }, { type: 'wheelchair' }] });
  assert.deepEqual(claims, ['amenity: attendant', 'amenity: valet']);
  assert.equal(deriveGateType(claims), undefined);
});

test('empty payload -> null (honest miss, nothing written)', () => {
  assert.equal(toGateEvidence({}, 'u', 'now'), null);
  assert.equal(toGateEvidence({ amenities: [{ type: 'wheelchair' }] }, 'u', 'now'), null);
});

console.log('\nall gateEvidence tests passed');
