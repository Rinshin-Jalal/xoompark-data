// Pure Sunbiz (Florida Division of Corporations) resolution — deliberately
// network- and Firestore-free (same split as every other sourcing module)
// so it runs under plain `node --experimental-strip-types`.
//
// Recon (2026-09-04, via Firecrawl — Sunbiz sits behind a Cloudflare
// challenge that blocks plain fetch): search results render as a markdown
// table (Corporate Name | Document Number | Status, detail links); the
// detail page carries entity type, principal/mailing address, registered
// agent, authorized persons (officers/managers + titles), and annual-report
// filing dates.
//
// Trap (from the plan): MDCPA owner names are uppercase and historically
// truncated (~30 chars) — "SOUTH BEACH PARKING ASSOC" vs Sunbiz "SOUTH
// BEACH PARKING ASSOCIATES LLC". Matching strips legal suffixes and scores
// exact > prefix > contains. Registered agent is often CT Corporation (a
// filing service) — stored, but never treated as the decision-maker.
import type { SourcedParkingLocation } from './types.ts';

export type EntityContext = NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['corporate_entity']>;

export const SUNBIZ_SEARCH_URL = 'https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults';

export interface SunbizSearchResult {
  name: string;
  documentNumber: string;
  status: string;
  detailUrl: string;
}

/** Owner names that look like a legal entity worth a Sunbiz lookup. */
const ENTITY_HINT = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|LTD|LIMITED|LP|L\.P|PARTNERSHIP|TRUST|HOLDINGS|PROPERTIES|ENTERPRISES|INVESTMENTS)\b/i;

const LEGAL_SUFFIX = /\b(LLC|L\.L\.C\.?|INC\.?|CORP\.?|CORPORATION|LTD\.?|LIMITED|LP|L\.P\.?|PARTNERSHIP|TRUST|HOLDINGS?)\b/g;

/** Uppercase, strip punctuation + legal suffixes, collapse whitespace —
 * the form both MDCPA and Sunbiz names normalize to for matching. */
export function normalizeEntityName(name: string): string {
  return name
    .toUpperCase()
    // remove punctuation outright (not to spaces) so L.L.C. -> LLC before
    // the suffix strip runs
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this owner-of-record look like a registered entity at all? */
export function looksLikeEntity(ownerName: string): boolean {
  return ENTITY_HINT.test(ownerName) || normalizeEntityName(ownerName).split(' ').length >= 2;
}

/** Search URL for an owner name — the audit trail for the lookup. */
export function buildSearchUrl(ownerName: string): string {
  const params = new URLSearchParams({ InquiryType: 'EntityName', SearchTerm: ownerName });
  return `${SUNBIZ_SEARCH_URL}?${params}`;
}

/**
 * Parse the search-results markdown table into result rows. Tolerant of the
 * Firecrawl markdown shape: `| [NAME](detailUrl) | DOCNUM | STATUS |`.
 */
export function parseSearchResults(markdown: string): SunbizSearchResult[] {
  const results: SunbizSearchResult[] = [];
  const rowRe = /\|\s*\[([^\]]+)\]\(([^)]+)\)[^|]*\|\s*([A-Z0-9]+)\s*\|\s*([A-Za-z]+)\s*\|/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(markdown)) !== null) {
    results.push({ name: m[1].trim(), documentNumber: m[3].trim(), status: m[4].trim(), detailUrl: m[2] });
  }
  return results;
}

/**
 * Match score: 3 exact, 2 prefix (handles MDCPA's truncated names), 1
 * contains. 0 = no match. Active status wins ties.
 */
export function matchScore(ownerName: string, resultName: string): number {
  const a = normalizeEntityName(ownerName);
  const b = normalizeEntityName(resultName);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (b.startsWith(a) || a.startsWith(b)) return 2;
  if (b.includes(a) || a.includes(b)) return 1;
  return 0;
}

/** Pick the best Sunbiz result for an owner-of-record name, or null. */
export function pickEntityMatch(ownerName: string, results: SunbizSearchResult[]): SunbizSearchResult | null {
  const scored = results
    .map((r) => ({ r, s: matchScore(ownerName, r.name) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => {
      const active = (Number(y.r.status === 'Active') - Number(x.r.status === 'Active'));
      if (active !== 0) return active;
      return y.s - x.s;
    });
  return scored.length ? scored[0].r : null;
}

function section(markdown: string, startRe: RegExp, endRe: RegExp): string {
  const start = markdown.search(startRe);
  if (start === -1) return '';
  const rest = markdown.slice(start).slice(markdown.slice(start).search(startRe) === 0 ? startRe.source.length : 0);
  const end = rest.search(endRe);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/**
 * Parse a Sunbiz detail page (Firecrawl markdown) into the stored context.
 * Tolerant: every field optional, regex-anchored on the page's stable
 * headings ("Detail by Entity Name", "Principal Address", "Registered Agent
 * Name & Address", "Authorized Person(s) Detail", "Annual Reports").
 */
export function parseDetailPage(markdown: string, sourceUrl: string, now: string): EntityContext | null {
  const detailIdx = markdown.indexOf('Detail by Entity Name');
  if (detailIdx === -1) return null;

  const ctx: EntityContext = { entityName: '', sourceUrl, checkedAt: now };

  const after = markdown.slice(detailIdx + 'Detail by Entity Name'.length).trim();
  const lines = after.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  // First non-empty line is the entity type, second is the name — unless the
  // type line is missing (older layouts); fall back to the first line as name.
  if (lines.length > 1 && /company|corporation|partnership|trust/i.test(lines[0])) {
    ctx.entityType = lines[0];
    ctx.entityName = lines[1];
  } else {
    ctx.entityName = lines[0];
  }
  if (!ctx.entityName) return null;

  const docNum = markdown.match(/Document Number\s*([A-Z]\d+)/);
  if (docNum) ctx.documentNumber = docNum[1];
  const status = markdown.match(/Status\s*(ACTIVE|INACT|Active|Inactive)\b/);
  if (status) ctx.status = status[1].toUpperCase();

  const principal = section(markdown, /Principal Address/, /Mailing Address|Registered Agent/);
  if (principal) {
    const addr = principal.replace('Principal Address', '').split('\n')
      .map((l) => l.trim()).filter((l) => l && !/^Changed:/i.test(l));
    if (addr.length) ctx.principalAddress = addr.join(', ');
  }

  const agent = section(markdown, /Registered Agent Name & Address/, /Authorized Person|Annual Reports/);
  if (agent) {
    const agentLines = agent.replace('Registered Agent Name & Address', '').split('\n')
      .map((l) => l.trim()).filter(Boolean);
    if (agentLines.length) ctx.registeredAgent = agentLines.join(', ');
  }

  const persons = section(markdown, /Authorized Person\(s\) Detail/, /Annual Reports/);
  if (persons) {
    const personLines = persons.split('\n')
      .map((l) => l.replace(/^\|/, '').trim())
      .filter((l) => l && !/^Authorized Person/i.test(l) && !/^Name & Address$/i.test(l) && !/^Title\b/.test(l));
    if (personLines.length) ctx.authorizedPersons = personLines;
  }

  // Annual-report table lists years ascending — the LAST row is the most
  // recent filing (the staleness check).
  const reports = [...markdown.matchAll(/\|\s*(\d{4})\s*\|\s*(\d{2}\/\d{2}\/\d{4})\s*\|/g)];
  if (reports.length) ctx.lastAnnualReportFiled = reports[reports.length - 1][2];

  return ctx;
}
