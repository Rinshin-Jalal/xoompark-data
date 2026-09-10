// Pure tri-state evaluation + sort logic for the 8 Waymo hard-filter checks
// on the sourcing review page. Deliberately Firestore/'server-only'-free
// (only imports types.ts, same split as geoContextParse.ts) so it's testable
// with plain `node --experimental-strip-types` and importable from both the
// server page (page.tsx, for sort order) and the client table
// (SourcingReviewTable.tsx, for badges + the summary strip).
import type { SourcedParkingLocation } from './types.ts';

export type HardFilterResult = 'pass' | 'fail' | 'unknown';

export interface HardFilterEval {
  result: HardFilterResult;
  /** Optional extra context shown on a failing badge (e.g. the FEMA flood zone letter). */
  detail?: string;
}

// The 8 hard-filter checks Waymo cares about. notResidentialAdjacent and
// aboveFloodPlain read geoContext; open247/is_fenced/is_lit/ingress_egressControlled/
// fiftyPlusStalls read the real schema fields (is_24_7/is_fenced/is_lit/
// ingress_egress/stall_count — #34); dedicatedStalls and cellCoverage stay
// 'unknown' until Phase II walk data exists.
export const HARD_FILTERS: { key: string; label: string }[] = [
  { key: 'dedicatedStalls', label: 'Dedicated stalls' },
  { key: 'open247', label: '24/7' },
  { key: 'is_fenced', label: 'Fenced' },
  { key: 'is_lit', label: 'Lit' },
  { key: 'ingress_egressControlled', label: 'Ingress/egress' },
  { key: 'cellCoverage', label: 'Cell coverage' },
  { key: 'notResidentialAdjacent', label: 'Not residential-adjacent' },
  { key: 'aboveFloodPlain', label: 'Above flood plain' },
  { key: 'fiftyPlusStalls', label: '50+ stalls' },
];

/** Hard-filter key -> flat schema field holding a tri-state boolean. */
const BOOLEAN_FIELD_BY_KEY: Record<string, 'is_24_7' | 'is_fenced' | 'is_lit'> = {
  open247: 'is_24_7',
  is_fenced: 'is_fenced',
  is_lit: 'is_lit',
};

/**
 * Evaluate one hard-filter key for one record. Tri-state discipline: true ->
 * pass, false -> fail (source affirmatively stated it), undefined/null ->
 * unknown. ingress_egressControlled is free text — presence of any recorded
 * text counts as checked (pass); we can't auto-judge content.
 */
export function evaluateHardFilter(location: SourcedParkingLocation, key: string): HardFilterEval {
  if (key === 'notResidentialAdjacent') {
    const residentialAdjacent = location.enrichment?.geo?.residentialAdjacent;
    if (residentialAdjacent === undefined) return { result: 'unknown' };
    return { result: residentialAdjacent ? 'fail' : 'pass' };
  }

  if (key === 'aboveFloodPlain') {
    const geo = location.enrichment?.geo;
    if (!geo || geo.floodHazardArea === undefined) return { result: 'unknown' };
    if (geo.floodHazardArea) return { result: 'fail', detail: geo.floodZone ? `Zone ${geo.floodZone}` : undefined };
    return { result: 'pass' };
  }

  if (key === 'fiftyPlusStalls') {
    const stalls = location.stall_count;
    if (typeof stalls !== 'number') return { result: 'unknown' };
    return { result: stalls >= 50 ? 'pass' : 'fail', detail: `${stalls} stalls` };
  }

  if (key === 'ingress_egressControlled') {
    const text = location.ingress_egress;
    // ponytail: free text can't be auto-judged pass/fail — recorded = checked;
    // swap for a structured enum if BDR data ever needs real fail detection.
    if (!text) return { result: 'unknown' };
    return { result: 'pass', detail: text };
  }

  const boolField = BOOLEAN_FIELD_BY_KEY[key];
  if (!boolField) return { result: 'unknown' }; // dedicatedStalls, cellCoverage
  const v = location[boolField];
  if (typeof v !== 'boolean') return { result: 'unknown' };
  return { result: v ? 'pass' : 'fail' };
}

/** True if ANY hard-filter key evaluates to a hard fail for this record — generalizes automatically as more keys get real data. */
export function hasHardFail(location: SourcedParkingLocation): boolean {
  return HARD_FILTERS.some((f) => evaluateHardFilter(location, f.key).result === 'fail');
}

/**
 * Deprioritize (never filter/hide) any record with at least one failed hard
 * filter to the bottom of the list. Preserves the existing created_at-desc
 * order as the secondary key within both the not-failed and failed groups.
 */
export function sortForReview(locations: SourcedParkingLocation[]): SourcedParkingLocation[] {
  return [...locations].sort((a, b) => {
    const aFail = hasHardFail(a) ? 1 : 0;
    const bFail = hasHardFail(b) ? 1 : 0;
    if (aFail !== bFail) return aFail - bFail;
    return b.created_at.localeCompare(a.created_at);
  });
}
