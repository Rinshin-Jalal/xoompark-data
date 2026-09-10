// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same style as addLocation.test.ts/extensionCapture.test.ts — only tests
// what's NEW for the "Paste HTML" admin panel: stripHtmlToText and
// buildManualPasteImportInput. Does NOT re-test tagExtractedFacilities or
// parseFirecrawlExtractResponse (already covered by extensionCapture.test.ts)
// and does not import capture.ts itself (that file pulls in 'server-only',
// which throws when imported outside a Next.js react-server build — the
// orchestration it adds is exercised live instead, see the task's
// verification step).
import assert from 'node:assert/strict';
import { buildManualPasteImportInput, extractFacilitiesFromText, stripHtmlToText } from '../extensionCapture.ts';
import type { ExtractedFacility } from '../extensionCapture.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// ── stripHtmlToText ──────────────────────────────────────────────────────────

test('stripHtmlToText: strips script tag content, not just the tags', () => {
  const html = '<div>Lot A</div><script>alert("hi"); var x = "<div>fake</div>";</script><div>Lot B</div>';
  const out = stripHtmlToText(html);
  assert.ok(!out.includes('alert'));
  assert.ok(!out.includes('fake'));
  assert.ok(out.includes('Lot A'));
  assert.ok(out.includes('Lot B'));
});

test('stripHtmlToText: strips style tag content', () => {
  const html = '<style>.foo { color: red; }</style><p>Downtown Garage</p>';
  const out = stripHtmlToText(html);
  assert.ok(!out.includes('color'));
  assert.ok(out.includes('Downtown Garage'));
});

test('stripHtmlToText: strips remaining tags and collapses whitespace', () => {
  const html = '<div class="lot">\n  <span>Name:</span>   Downtown  \n  <span>$10/hr</span>\n</div>';
  const out = stripHtmlToText(html);
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes('>'));
  assert.ok(!/\s{2,}/.test(out));
  assert.ok(out.includes('Downtown'));
  assert.ok(out.includes('$10/hr'));
});

test('stripHtmlToText: already-plain text passes through (whitespace-collapsed)', () => {
  const out = stripHtmlToText('Downtown  Garage\n\n$10/hr');
  assert.equal(out, 'Downtown Garage $10/hr');
});

test('stripHtmlToText: no crash on garbage/malformed markup', () => {
  const out = stripHtmlToText('<div><span>unclosed <b>bold text');
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('unclosed'));
});

test('stripHtmlToText: no crash on empty input', () => {
  assert.equal(stripHtmlToText(''), '');
});

// ── extractFacilitiesFromText ────────────────────────────────────────────────

test('extractFacilitiesFromText: single block (no repeated container) -> one facility', () => {
  const html = '<div><h2>Downtown Garage</h2><p>123 Main St, Miami, FL 33130</p><p>$10/hr, 24/7</p></div>';
  const out = extractFacilitiesFromText(html);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Downtown Garage');
  assert.equal(out[0].address, '123 Main St, Miami, FL 33130');
  assert.equal(out[0].priceText, '$10/hr');
  assert.match(out[0].hoursText ?? '', /24/);
});

test('extractFacilitiesFromText: repeated card class -> splits into multiple facilities', () => {
  const html = [
    '<div class="listing-card"><h3>Lot A</h3><span>50 spaces</span></div>',
    '<div class="listing-card"><h3>Lot B</h3><span>120 stalls</span></div>',
  ].join('');
  const out = extractFacilitiesFromText(html);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Lot A');
  assert.equal(out[0].capacityText, '50 spaces');
  assert.equal(out[1].name, 'Lot B');
  assert.equal(out[1].capacityText, '120 stalls');
});

test('extractFacilitiesFromText: plain text (no tags) falls back to first-line name', () => {
  const out = extractFacilitiesFromText('Riverside Lot\n456 Elm Rd, Austin, TX 78701\n$5/day');
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Riverside Lot');
  assert.equal(out[0].priceText, '$5/day');
});

test('extractFacilitiesFromText: no crash and no rows on empty/garbage input', () => {
  assert.deepEqual(extractFacilitiesFromText(''), []);
  assert.deepEqual(extractFacilitiesFromText('<div><span></span></div>'), []);
});

test('extractFacilitiesFromText: clearance and capacity regexes match common phrasings', () => {
  const out = extractFacilitiesFromText("Airport Garage\nClearance: 6'8\"\n300 spaces");
  assert.equal(out.length, 1);
  assert.match(out[0].clearanceText ?? '', /6'8/);
  assert.equal(out[0].capacityText, '300 spaces');
});

// ── buildManualPasteImportInput ──────────────────────────────────────────────

const FACILITY: ExtractedFacility = {
  name: 'Downtown Garage',
  address: '123 Main St, Miami, FL',
  priceText: '$10/hr',
};

test('buildManualPasteImportInput: source manual, capturedBy admin', () => {
  const input = buildManualPasteImportInput(FACILITY, 'https://example.com/lot');
  assert.ok(input);
  assert.equal(input?.source, 'manual');
  assert.equal(input?.capturedBy, 'admin');
});

test('buildManualPasteImportInput: sourceListingId matches addLocation.ts slug scheme', () => {
  const input = buildManualPasteImportInput(FACILITY, 'https://example.com/lot');
  // slugifyCity('Downtown Garage-123 Main St, Miami, FL').slice(0, 80)
  assert.equal(input?.sourceListingId, 'downtown-garage-123-main-st-miami-fl');
});

test('buildManualPasteImportInput: blank address falls back to slugifying name alone', () => {
  const input = buildManualPasteImportInput({ name: 'Lot Without Address' }, 'https://example.com/lot');
  assert.equal(input?.sourceListingId, 'lot-without-address');
});

test('buildManualPasteImportInput: fieldProvenance self-reported only on present fields', () => {
  const input = buildManualPasteImportInput(FACILITY, 'https://example.com/lot');
  assert.equal(input?.fieldProvenance?.name, 'self-reported');
  assert.equal(input?.fieldProvenance?.address, 'self-reported');
  assert.equal(input?.fieldProvenance?.priceText, 'self-reported');
  assert.equal('hoursText' in (input?.fieldProvenance ?? {}), false);
  assert.equal('capacityText' in (input?.fieldProvenance ?? {}), false);
  assert.equal('clearanceText' in (input?.fieldProvenance ?? {}), false);
});

test('buildManualPasteImportInput: returns null when sourceUrl is blank', () => {
  assert.equal(buildManualPasteImportInput(FACILITY, ''), null);
  assert.equal(buildManualPasteImportInput(FACILITY, '   '), null);
});

test('buildManualPasteImportInput: rawInput is the extracted facility itself', () => {
  const input = buildManualPasteImportInput(FACILITY, 'https://example.com/lot');
  assert.equal(input?.rawInput, FACILITY);
});

console.log('\nall capture tests passed');
