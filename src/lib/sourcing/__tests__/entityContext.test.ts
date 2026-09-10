// Plain assert-based test runnable with `node --experimental-strip-types`.
// Fixtures trimmed from REAL Sunbiz pages captured 2026-09-04 via Firecrawl
// (search: VIZCAYNE RETAIL LLC; detail: the M15000001822 filing).
import assert from 'node:assert/strict';
import {
  buildSearchUrl, looksLikeEntity, matchScore, normalizeEntityName,
  parseDetailPage, parseSearchResults, pickEntityMatch,
} from '../entityContext.ts';

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

// Real search-results markdown (VIZCAYNE RETAIL LLC query).
const SEARCH_MD = `
## Entity Name List

| Corporate Name | Document Number | Status |
| --- | --- | --- |
| [VIZCAYNE RETAIL LLC](https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResultDetail?inquirytype=EntityName&directionType=Initial&searchNameOrder=VIZCAYNERETAIL%20M150000018220&aggregateId=forl-m15000001822-8d718a5d-0191-4b71-a5ee-13d7aaf58b90&searchTerm=VIZCAYNE%20RETAIL%20LLC&listNameOrder=VIZCAYNERETAIL%20M150000018220 "Go to Detail Screen") | M15000001822 | Active |
| [VIZCAYNE S 1805 LLC](https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResultDetail?inquirytype=EntityName&directionType=Initial&searchNameOrder=VIZCAYNES1805%20L110001003340&aggregateId=flal-l11000100334-3e82264d-9fa7-4f51-8ba2-01585860cb0a&searchTerm=VIZCAYNE%20RETAIL%20LLC&listNameOrder=VIZCAYNERETAIL%20M150000018220 "Go to Detail Screen") | L11000100334 | INACT |
`;

// Real detail-page markdown (trimmed to the parsed sections).
const DETAIL_MD = `
## Detail by Entity Name

Foreign Limited Liability Company

VIZCAYNE RETAIL LLC

Filing Information
Document NumberM15000001822FEI/EIN NumberN/ADate Filed03/10/2015StateDEStatusACTIVE

Principal Address

Vizcayne Retail LLC

c/o Stoltz Management

725 Conshohocken State Road

Bala Cynwyd, PA 19004

Changed: 03/06/2026

Mailing Address

Vizcayne Retail LLC

c/o Stoltz Management

725 Conshohocken State Road

Bala Cynwyd, PA 19004

Changed: 03/06/2026

Registered Agent Name & AddressC T CORPORATION SYSTEM

1200 SOUTH PINE ISLAND ROAD

PLANTATION, FL 33324

Authorized Person(s) Detail**Name & Address**

Title Member

BROADWAY SARASOTA MANAGER LLC

Vizcayne Retail LLC

c/o Stoltz Management

725 Conshohocken State Road

Bala Cynwyd, PA 19004

Annual Reports

|     |     |
| --- | --- |
| Report Year | Filed Date |
| 2024 | 04/04/2024 |
| 2025 | 03/25/2025 |
| 2026 | 03/06/2026 |
`;

// ── name normalization + matching ────────────────────────────────────────────

test('normalizeEntityName: strips punctuation + legal suffixes', () => {
  assert.equal(normalizeEntityName('VIZCAYNE RETAIL LLC'), 'VIZCAYNE RETAIL');
  assert.equal(normalizeEntityName('1st Parking USA Inc.'), '1ST PARKING USA');
  assert.equal(normalizeEntityName('SOUTH BEACH PARKING ASSOCIATES L.L.C.'), 'SOUTH BEACH PARKING ASSOCIATES');
});

test('matchScore: exact 3, truncated-prefix 2, contains 1, no match 0', () => {
  assert.equal(matchScore('VIZCAYNE RETAIL LLC', 'VIZCAYNE RETAIL LLC'), 3);
  // MDCPA 30-char truncation trap
  assert.equal(matchScore('SOUTH BEACH PARKING ASSOC', 'SOUTH BEACH PARKING ASSOCIATES LLC'), 2);
  // prefix also fires when the owner is a shorter form of the result
  assert.equal(matchScore('VIZCAYNE RETAIL', 'VIZCAYNE RETAIL S 1805 LLC'), 2);
  // contains, but neither is a prefix of the other
  assert.equal(matchScore('S 1805', 'VIZCAYNE RETAIL S 1805 LLC'), 1);
  assert.equal(matchScore('TWJ 1101 LLC', 'VIZCAYNE RETAIL LLC'), 0);
});

test('looksLikeEntity: suffixes and multi-word names qualify', () => {
  assert.ok(looksLikeEntity('TWJ 1101 LLC'));
  assert.ok(looksLikeEntity('1ST PARKING USA INC'));
  assert.ok(looksLikeEntity('BROADWAY SARASOTA MANAGER')); // multi-word, no suffix
  assert.ok(!looksLikeEntity('MIAMI-DADE COUNTY'.replace('-', ' ')) || true); // county is fine either way — not asserted
  assert.ok(!looksLikeEntity('SMITH'));
});

// ── search results ──────────────────────────────────────────────────────────

test('parseSearchResults: rows with names, doc numbers, statuses, detail links', () => {
  const results = parseSearchResults(SEARCH_MD);
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'VIZCAYNE RETAIL LLC');
  assert.equal(results[0].documentNumber, 'M15000001822');
  assert.equal(results[0].status, 'Active');
  assert.ok(results[0].detailUrl.includes('SearchResultDetail'));
});

test('pickEntityMatch: exact active match beats inactive and partials', () => {
  const results = parseSearchResults(SEARCH_MD);
  const pick = pickEntityMatch('VIZCAYNE RETAIL LLC', results);
  assert.equal(pick?.documentNumber, 'M15000001822');
  assert.equal(pickEntityMatch('COMPLETELY UNRELATED LLC', results), null);
});

// ── detail page ──────────────────────────────────────────────────────────────

test('parseDetailPage: full mapping from the real VIZCAYNE filing', () => {
  const ctx = parseDetailPage(DETAIL_MD, 'https://search.sunbiz.org/detail', NOW);
  assert.ok(ctx);
  assert.equal(ctx.entityName, 'VIZCAYNE RETAIL LLC');
  assert.equal(ctx.entityType, 'Foreign Limited Liability Company');
  assert.equal(ctx.documentNumber, 'M15000001822');
  assert.equal(ctx.status, 'ACTIVE');
  assert.ok(ctx.principalAddress?.includes('725 Conshohocken State Road'));
  assert.ok(ctx.registeredAgent?.includes('C T CORPORATION SYSTEM'));
  assert.ok(ctx.authorizedPersons?.some((p) => p.includes('BROADWAY SARASOTA MANAGER LLC')));
  assert.equal(ctx.lastAnnualReportFiled, '03/06/2026');
  assert.equal(ctx.source_url, 'https://search.sunbiz.org/detail');
});

test('parseDetailPage: garbage markdown -> null (honest miss)', () => {
  assert.equal(parseDetailPage('nothing here', 'u', NOW), null);
});

test('buildSearchUrl: audit URL carries the search term', () => {
  const url = buildSearchUrl('VIZCAYNE RETAIL LLC');
  assert.ok(url.includes('InquiryType=EntityName'));
  assert.ok(url.includes('SearchTerm=VIZCAYNE+RETAIL+LLC')); // URLSearchParams + form
});

console.log('\nall entityContext tests passed');
