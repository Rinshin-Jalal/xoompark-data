// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same Firestore-free style as the sourcing tests — only imports feedback.ts.
import assert from 'node:assert/strict';
import { parseFeedbackBody, feedbackDocId, MAX_REASONS, MAX_REASON_LENGTH, MAX_NOTES_LENGTH } from '../feedback.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('accepts minimal body: decision only', () => {
  const r = parseFeedbackBody({ decision: 'selected' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.decision, 'selected');
    assert.deepEqual(r.value.reasons, []);
    assert.equal(r.value.notes, null);
  }
});

test('accepts full body', () => {
  const r = parseFeedbackBody({ decision: 'rejected', reasons: ['no cell coverage', 'shared stalls'], notes: 'walked 2026-08-30' });
  assert.equal(r.ok, true);
});

test('rejects non-objects: null, arrays, strings, numbers, booleans', () => {
  for (const bad of [null, [], 'selected', 42, true, undefined]) {
    const r = parseFeedbackBody(bad);
    assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('rejects bad decisions', () => {
  for (const bad of ['SELECTED', 'maybe', '', null, 1, undefined, {}]) {
    const r = parseFeedbackBody({ decision: bad });
    assert.equal(r.ok, false, `expected rejection for decision=${JSON.stringify(bad)}`);
  }
});

test('rejects non-string-array reasons', () => {
  for (const bad of ['no-cell', 42, null, {}, ['ok', 42], ['ok', null], ['ok', {}]]) {
    const r = parseFeedbackBody({ decision: 'selected', reasons: bad });
    assert.equal(r.ok, false, `expected rejection for reasons=${JSON.stringify(bad)}`);
  }
});

test('rejects non-string notes', () => {
  for (const bad of [42, null, [], {}, true]) {
    const r = parseFeedbackBody({ decision: 'selected', notes: bad });
    assert.equal(r.ok, false, `expected rejection for notes=${JSON.stringify(bad)}`);
  }
});

test('enforces size caps at the exact boundary', () => {
  const okReasons = Array.from({ length: MAX_REASONS }, () => 'x');
  assert.equal(parseFeedbackBody({ decision: 'selected', reasons: okReasons }).ok, true);
  const tooMany = Array.from({ length: MAX_REASONS + 1 }, () => 'x');
  assert.equal(parseFeedbackBody({ decision: 'selected', reasons: tooMany }).ok, false);

  const okReason = 'x'.repeat(MAX_REASON_LENGTH);
  assert.equal(parseFeedbackBody({ decision: 'selected', reasons: [okReason] }).ok, true);
  assert.equal(parseFeedbackBody({ decision: 'selected', reasons: [okReason + 'x'] }).ok, false);

  assert.equal(parseFeedbackBody({ decision: 'selected', notes: 'x'.repeat(MAX_NOTES_LENGTH) }).ok, true);
  assert.equal(parseFeedbackBody({ decision: 'selected', notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }).ok, false);
});

test('extra junk fields are ignored, not stored', () => {
  const r = parseFeedbackBody({ decision: 'selected', siteId: 'evil', fleet: 'spoofed', __proto__: 'x' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(Object.keys(r.value).sort(), ['decision', 'notes', 'reasons']);
  }
});

test('unicode and control chars in strings pass through (Firestore-safe)', () => {
  const r = parseFeedbackBody({ decision: 'selected', reasons: ['🅿️ café'], notes: 'line\nbreak\ttab' });
  assert.equal(r.ok, true);
});

// --- doc id -------------------------------------------------------------------

test('docId is deterministic: same key+site -> same id', () => {
  assert.equal(feedbackDocId('key1', 'spothero:123'), feedbackDocId('key1', 'spothero:123'));
  assert.notEqual(feedbackDocId('key1', 'spothero:123'), feedbackDocId('key2', 'spothero:123'));
  assert.notEqual(feedbackDocId('key1', 'spothero:123'), feedbackDocId('key1', 'spothero:456'));
});

test('docId sanitizes slashes (illegal in Firestore doc ids)', () => {
  const id = feedbackDocId('key/1', 'addr:foo/bar');
  assert.ok(!id.includes('/'), `slash survived: ${id}`);
  assert.ok(id.includes('_'), 'sanitized to underscore');
});

test('docId stays under the Firestore 1500-byte limit', () => {
  const id = feedbackDocId('k'.repeat(200), 's'.repeat(5000));
  assert.ok(id.length <= 1200, `docId too long: ${id.length}`);
  assert.ok(id.length > 0);
});

test('docId handles unicode and empty parts without throwing', () => {
  assert.doesNotThrow(() => feedbackDocId('🎉', 'café-lot'));
  assert.doesNotThrow(() => feedbackDocId('', ''));
  assert.ok(feedbackDocId('', '').length >= 2); // '__' separator survives
});

// --- fuzz ----------------------------------------------------------------------

test('FUZZ: 2000 random junk bodies never throw and never leak unvalidated data', () => {
  let seed = 0xfeedface;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const junk = [null, undefined, 42, true, 'selected', [], {}, { decision: 'maybe' }, { decision: 'selected', reasons: 'no' }, { decision: 'selected', reasons: [42] }, { decision: 'selected', notes: [] }, { decision: null }, { decision: 'selected', reasons: Array.from({ length: 100 }, () => 'x') }, { decision: 'rejected', reasons: ['ok', 'x'.repeat(1000)] }];
  for (let i = 0; i < 2000; i++) {
    const body = rand() < 0.5 ? junk[Math.floor(rand() * junk.length)] : { decision: rand() < 0.5 ? 'selected' : 'rejected' };
    let r: ReturnType<typeof parseFeedbackBody>;
    try {
      r = parseFeedbackBody(body);
    } catch (err) {
      throw new Error(`parseFeedbackBody threw on ${JSON.stringify(body)}: ${err}`);
    }
    if (r.ok) {
      // Anything accepted is fully validated shape.
      assert.ok(r.value.decision === 'selected' || r.value.decision === 'rejected');
      assert.ok(Array.isArray(r.value.reasons));
      assert.ok(r.value.reasons.every((x) => typeof x === 'string' && x.length <= MAX_REASON_LENGTH));
      assert.ok(r.value.notes === null || typeof r.value.notes === 'string');
    }
  }
});

console.log('fleet feedback: all tests passed');
