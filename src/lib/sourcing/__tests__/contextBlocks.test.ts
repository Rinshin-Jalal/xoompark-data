// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Tests the pure display helpers extracted from SourcingReviewTable.tsx's
// context blocks. No DOM, no React — same pattern as deriveServices.test.ts.
import assert from 'node:assert/strict';

// --- fmtNum (number formatting with commas) ---
function fmtNum(n: number | null | undefined): string {
  return n != null ? n.toLocaleString('en-US') : '—';
}

// --- detailValue (existing helper, tested here for completeness) ---
function detailValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// --- hostOf (existing helper) ---
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// --- formatWhen (existing helper) ---
function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// --- AmenityContext wash/service threshold logic ---
const WASH_NEAR_M = 200;
const SERVICE_NEAR_M = 200;

function washHighlight(m: number | null | undefined): boolean {
  return m != null && m < WASH_NEAR_M;
}
function svcHighlight(m: number | null | undefined): boolean {
  return m != null && m < SERVICE_NEAR_M;
}

// --- Authorized persons truncation ---
function truncatePersons(persons: string[], max = 3): { shown: string[]; more: number } {
  const shown = persons.slice(0, max);
  const more = persons.length > max ? persons.length - max : 0;
  return { shown, more };
}

// --- Tests ---
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// fmtNum
test('fmtNum: number with commas', () => {
  assert.equal(fmtNum(12345), '12,345');
});
test('fmtNum: zero', () => {
  assert.equal(fmtNum(0), '0');
});
test('fmtNum: null → dash', () => {
  assert.equal(fmtNum(null), '—');
});
test('fmtNum: undefined → dash', () => {
  assert.equal(fmtNum(undefined), '—');
});

// detailValue
test('detailValue: undefined → dash', () => {
  assert.equal(detailValue(undefined), '—');
});
test('detailValue: null → dash', () => {
  assert.equal(detailValue(null), '—');
});
test('detailValue: empty string → dash', () => {
  assert.equal(detailValue(''), '—');
});
test('detailValue: true → Yes', () => {
  assert.equal(detailValue(true), 'Yes');
});
test('detailValue: false → No', () => {
  assert.equal(detailValue(false), 'No');
});
test('detailValue: string passthrough', () => {
  assert.equal(detailValue('hello'), 'hello');
});
test('detailValue: number stringified', () => {
  assert.equal(detailValue(42), '42');
});

// hostOf
test('hostOf: gisweb', () => {
  assert.equal(hostOf('https://gisweb.miamidade.gov/parcel/123'), 'gisweb.miamidade.gov');
});
test('hostOf: sunbiz', () => {
  assert.equal(hostOf('https://search.sunbiz.org/Inquiry/CorpSearch'), 'search.sunbiz.org');
});
test('hostOf: strips www', () => {
  assert.equal(hostOf('https://www.example.com/path'), 'example.com');
});

// formatWhen
test('formatWhen: null → dash', () => {
  assert.equal(formatWhen(null), '—');
});
test('formatWhen: undefined → dash', () => {
  assert.equal(formatWhen(undefined), '—');
});
test('formatWhen: valid ISO date', () => {
  const result = formatWhen('2025-03-15T00:00:00.000Z');
  assert.ok(result.includes('Mar'), `expected month in output, got: ${result}`);
  assert.ok(result.includes('2025'), `expected year in output, got: ${result}`);
});
test('formatWhen: invalid string → raw passthrough', () => {
  assert.equal(formatWhen('not-a-date'), 'not-a-date');
});

// Amenity threshold logic
test('amenity: wash < 200m triggers highlight', () => {
  assert.equal(washHighlight(150), true);
});
test('amenity: wash ≥ 200m no highlight', () => {
  assert.equal(washHighlight(200), false);
  assert.equal(washHighlight(300), false);
});
test('amenity: wash null no highlight', () => {
  assert.equal(washHighlight(null), false);
  assert.equal(washHighlight(undefined), false);
});
test('amenity: service < 200m triggers highlight', () => {
  assert.equal(svcHighlight(100), true);
});
test('amenity: service ≥ 200m no highlight', () => {
  assert.equal(svcHighlight(250), false);
});

// Authorized persons truncation
test('persons: fewer than 3 shown in full', () => {
  const p = truncatePersons(['Alice', 'Bob']);
  assert.deepEqual(p.shown, ['Alice', 'Bob']);
  assert.equal(p.more, 0);
});
test('persons: exactly 3 shown', () => {
  const p = truncatePersons(['A', 'B', 'C']);
  assert.deepEqual(p.shown, ['A', 'B', 'C']);
  assert.equal(p.more, 0);
});
test('persons: 5 → show 3, +2 more', () => {
  const p = truncatePersons(['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(p.shown, ['A', 'B', 'C']);
  assert.equal(p.more, 2);
});
test('persons: empty array', () => {
  const p = truncatePersons([]);
  assert.deepEqual(p.shown, []);
  assert.equal(p.more, 0);
});

console.log('\n--- all context block tests passed ---');
