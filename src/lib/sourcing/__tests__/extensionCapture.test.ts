// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same style as laz.test.ts/addLocation.test.ts — only imports from
// extensionCapture.ts/types.ts (Firestore/'server-only'-free), never
// firecrawlExtractClient.ts (network) or the route handlers themselves.
//
// The parse fixture below is the REAL, unedited response body from a live
// Firecrawl /v1/extract call made during this task's recon (2026-08-24)
// against https://spothero.com/destination/miami/downtown-miami-parking —
// same page spothero.ts's own recon comment already documents as a real
// Miami facility-listing source. Job: POST /v1/extract kicked off id
// 01a033b2-b478-7366-9acc-3df734e60127, polled via GET
// /v1/extract/:id to status:"completed" (37 credits, 543 tokens). Not
// fabricated — copied verbatim from that response's `data` shape.
import assert from 'node:assert/strict';
import {
  buildExtensionImportInput,
  buildExtractPrompt,
  computeExtensionDedupeKey,
  parseFirecrawlExtractResponse,
  tagExtractedFacilities,
} from '../extensionCapture.ts';
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

// Real /v1/extract completed response body (data.facilities), verbatim.
const REAL_SPOTHERO_EXTRACT_RESPONSE = {
  success: true,
  data: {
    facilities: [
      { name: 'Hyatt Regency Miami Valet.', address: '400 SE 2nd Ave', priceText: 'starting at $63.60', hoursText: '', capacityText: '', clearanceText: '' },
      { name: '100 SE 2nd St. - James L. Knight Center Garage', address: '100 SE 2nd St', priceText: 'starting at $15.99', hoursText: '', capacityText: '', clearanceText: '' },
      { name: '200 SE 2nd Ave. - Courtyard Miami AVR Garage', address: '200 SE 2nd Ave', priceText: 'starting at $26.50', hoursText: '', capacityText: '', clearanceText: '' },
      { name: '60 SE 2nd St. - Lot', address: '60 SE 2nd St', priceText: 'starting at $18.82', hoursText: '', capacityText: '', clearanceText: '' },
      { name: '45 SE 2nd St. - Mana Garage', address: '45 SE 2nd St', priceText: 'starting at $12.99', hoursText: '', capacityText: '', clearanceText: '' },
      { name: '240 S Miami Ave. (60 SE 2nd St.) - Lot', address: '240 S Miami Ave. (60 SE 2nd St.)', priceText: 'starting at $18.82', hoursText: '', capacityText: '', clearanceText: '' },
    ],
  },
  status: 'completed',
  expiresAt: '2026-08-24T18:16:15.000Z',
  tokensUsed: 543,
  creditsUsed: 37,
  warnings: ["/v1/extract/:jobId is deprecated. Use /v2/scrape with formats including a 'json' format object."],
  replacement: '/v2/scrape',
};

// ── parseFirecrawlExtractResponse (real fixture) ────────────────────────────

test('parseFirecrawlExtractResponse: parses all 6 real facilities from the fixture', () => {
  const facilities = parseFirecrawlExtractResponse(REAL_SPOTHERO_EXTRACT_RESPONSE);
  assert.equal(facilities.length, 6);
  assert.equal(facilities[0].name, 'Hyatt Regency Miami Valet.');
  assert.equal(facilities[0].address, '400 SE 2nd Ave');
  assert.equal(facilities[0].priceText, 'starting at $63.60');
});

test('parseFirecrawlExtractResponse: real fixture\'s "" empty strings normalize to undefined, never kept as ""', () => {
  const facilities = parseFirecrawlExtractResponse(REAL_SPOTHERO_EXTRACT_RESPONSE);
  for (const f of facilities) {
    assert.equal(f.hoursText, undefined, `${f.name} hoursText`);
    assert.equal(f.capacityText, undefined, `${f.name} capacityText`);
    assert.equal(f.clearanceText, undefined, `${f.name} clearanceText`);
  }
});

test('parseFirecrawlExtractResponse: throws on success:false', () => {
  assert.throws(() => parseFirecrawlExtractResponse({ success: false, error: 'boom' }), /did not succeed/);
});

test('parseFirecrawlExtractResponse: missing/malformed facilities array -> empty result, no throw', () => {
  assert.deepEqual(parseFirecrawlExtractResponse({ success: true, data: {} }), []);
});

test('parseFirecrawlExtractResponse: rows with no name are dropped (name is required)', () => {
  const facilities = parseFirecrawlExtractResponse({
    success: true,
    data: { facilities: [{ address: 'no name here' }, { name: 'Has A Name' }] },
  });
  assert.equal(facilities.length, 1);
  assert.equal(facilities[0].name, 'Has A Name');
});

// ── buildExtractPrompt ───────────────────────────────────────────────────────

test('buildExtractPrompt: embeds the captured domText verbatim between markers', () => {
  const prompt = buildExtractPrompt('SOME CAPTURED TEXT 123');
  assert.ok(prompt.includes('SOME CAPTURED TEXT 123'));
  assert.ok(prompt.includes('CAPTURED PAGE TEXT'));
  assert.ok(prompt.includes('Use ONLY the text'));
});

// ── computeExtensionDedupeKey ────────────────────────────────────────────────

test('computeExtensionDedupeKey: deterministic for the same name+address', () => {
  const f: ExtractedFacility = { name: 'Wynwood Garage', address: '321 NW 26th St, Miami, FL 33127' };
  assert.equal(computeExtensionDedupeKey(f), computeExtensionDedupeKey({ ...f }));
});

test('computeExtensionDedupeKey: different address -> different key', () => {
  const a = computeExtensionDedupeKey({ name: 'Wynwood Garage', address: '321 NW 26th St' });
  const b = computeExtensionDedupeKey({ name: 'Wynwood Garage', address: '999 Other St' });
  assert.notEqual(a, b);
});

test('computeExtensionDedupeKey: never throws when address is missing (falls back to name-only slug)', () => {
  assert.doesNotThrow(() => computeExtensionDedupeKey({ name: 'No Address Garage' }));
});

test('computeExtensionDedupeKey: always namespaced under the extension source', () => {
  const key = computeExtensionDedupeKey({ name: 'Wynwood Garage', address: '321 NW 26th St' });
  assert.ok(key.startsWith('extension:'), key);
});

// ── tagExtractedFacilities: the three tag paths ──────────────────────────────

test('tagExtractedFacilities: NEW when neither Firestore nor the batch has seen this key', () => {
  const facilities: ExtractedFacility[] = [{ name: 'Fresh Lot', address: '1 New St' }];
  const [tagged] = tagExtractedFacilities(facilities, new Map());
  assert.equal(tagged.tag, 'NEW');
  assert.equal(tagged.existingId, undefined);
});

test('tagExtractedFacilities: EXISTS when the computed key already has a Firestore doc', () => {
  const facilities: ExtractedFacility[] = [{ name: 'Old Lot', address: '2 Known St' }];
  const key = computeExtensionDedupeKey(facilities[0]);
  const existingIds = new Map([[key, key]]);
  const [tagged] = tagExtractedFacilities(facilities, existingIds);
  assert.equal(tagged.tag, 'EXISTS');
  assert.equal(tagged.existingId, key);
});

test('tagExtractedFacilities: DUPLICATE when two facilities in THIS batch share a key (not a Firestore match)', () => {
  const facilities: ExtractedFacility[] = [
    { name: 'Repeat Lot', address: '3 Twice St', priceText: '$5' },
    { name: 'Repeat Lot', address: '3 Twice St', priceText: '$5 (scraped twice)' }, // Firecrawl returning the same listing twice
  ];
  const tagged = tagExtractedFacilities(facilities, new Map());
  assert.equal(tagged[0].tag, 'NEW'); // first occurrence keeps its own tag
  assert.equal(tagged[1].tag, 'DUPLICATE');
  assert.equal(tagged[1].existingId, undefined); // DUPLICATE is in-batch, not a Firestore match
});

test('tagExtractedFacilities: a firm Firestore EXISTS match beats an in-batch collision', () => {
  const facilities: ExtractedFacility[] = [
    { name: 'Known Lot', address: '4 Firm St' },
    { name: 'Known Lot', address: '4 Firm St' },
  ];
  const key = computeExtensionDedupeKey(facilities[0]);
  const existingIds = new Map([[key, key]]);
  const tagged = tagExtractedFacilities(facilities, existingIds);
  assert.equal(tagged[0].tag, 'EXISTS');
  assert.equal(tagged[1].tag, 'EXISTS'); // still EXISTS, not downgraded to DUPLICATE
});

test('tagExtractedFacilities: distinct facilities in the same batch are independently NEW', () => {
  const facilities: ExtractedFacility[] = [
    { name: 'Lot A', address: '10 A St' },
    { name: 'Lot B', address: '20 B St' },
  ];
  const tagged = tagExtractedFacilities(facilities, new Map());
  assert.equal(tagged[0].tag, 'NEW');
  assert.equal(tagged[1].tag, 'NEW');
});

test('tagExtractedFacilities: real SpotHero fixture batch — all 6 distinct facilities tag NEW against an empty store', () => {
  const facilities = parseFirecrawlExtractResponse(REAL_SPOTHERO_EXTRACT_RESPONSE);
  const tagged = tagExtractedFacilities(facilities, new Map());
  assert.equal(tagged.filter((t) => t.tag === 'NEW').length, 6);
});

// ── buildExtensionImportInput ────────────────────────────────────────────────

test('buildExtensionImportInput: maps a full facility, source is "extension", capturedBy is "bdr-captured"', () => {
  const input = buildExtensionImportInput(
    { name: 'Wynwood Garage', address: '321 NW 26th St', priceText: '$10/day' },
    'https://spothero.com/destination/miami/downtown-miami-parking',
  );
  assert.ok(input);
  assert.equal(input!.source, 'extension');
  assert.equal(input!.sourceUrl, 'https://spothero.com/destination/miami/downtown-miami-parking');
  assert.equal(input!.capturedBy, 'bdr-captured');
  assert.equal(input!.name, 'Wynwood Garage');
  assert.equal(input!.priceText, '$10/day');
});

test('buildExtensionImportInput: every populated field is self-reported provenance, empty fields absent', () => {
  const input = buildExtensionImportInput(
    { name: 'Wynwood Garage', address: '321 NW 26th St', priceText: '$10/day' },
    'https://example.com/page',
  )!;
  assert.equal(input.fieldProvenance!.name, 'self-reported');
  assert.equal(input.fieldProvenance!.address, 'self-reported');
  assert.equal(input.fieldProvenance!.priceText, 'self-reported');
  assert.equal(input.fieldProvenance!.hoursText, undefined); // never captured -> no entry at all
});

test('buildExtensionImportInput: missing captured tab URL -> null (caller counts as skipped)', () => {
  const input = buildExtensionImportInput({ name: 'Some Garage' }, '');
  assert.equal(input, null);
});

test('buildExtensionImportInput: rawInput is the raw extracted facility itself', () => {
  const facility: ExtractedFacility = { name: 'Wynwood Garage', address: '321 NW 26th St' };
  const input = buildExtensionImportInput(facility, 'https://example.com')!;
  assert.deepEqual(input.rawInput, facility);
});

console.log('\nall extensionCapture tests passed');
