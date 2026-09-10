// Pure logic for the BDR (non-technical) view of the sourcing review page —
// queue ordering, per-record checklist derivation, and the admin-jargon ->
// plain-language translation lookups. Deliberately Firestore/'server-only'-
// free (only imports hardFilters.ts and types.ts, both of which are
// themselves Firestore-free) so it's testable with plain
// `node --experimental-strip-types`, same split as hardFilters.ts and
// geoContextParse.ts. SourcingReviewTable.tsx and BdrQueueView.tsx stay
// UI-only and import from here rather than growing their own untested logic.
import { evaluateHardFilter } from './hardFilters.ts';
import { isInWaymoOdd } from './types.ts';
import type { FieldProvenanceValue, SourcedParkingLocation, SourcingStatus } from './types.ts';

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

// --- Checklist ---------------------------------------------------------

// The general escalation ladder every field playbook in docs/bdr-workflow.md
// funnels into (its section 2, "Source priority ladder (per lot)") — same
// steps apply to every field below, just re-applied per field rather than
// each field having its own distinct research path (the doc doesn't have
// separate ladders per field, only one ladder + one field-specific "where
// to look first" note per field).
export const GENERAL_LADDER: string[] = [
  "Operator's own website — closest to the truth",
  'The existing SpotHero/Parkopedia listing already on the record — cross-check, don’t trust it blindly',
  'Google Street View / satellite view — walk or drive the lot virtually',
  'Google Maps listing — hours, photos, review intelligence',
  'Municipal or county public records (facility registries, property appraiser)',
  'Phone/email the operator — last resort, checklist questions only, log the answer with a date',
];

interface ChecklistFieldDef {
  key: string;
  label: string;
  /** Specific recording guidance, derived from the doc's own per-field text
   * (docs/bdr-workflow.md section 1). Never invents claims (numeric ranges,
   * absolute rules) beyond what the doc actually states. */
  guidance: string;
  isEmpty: (loc: SourcedParkingLocation) => boolean;
}

// Same kill-order the doc states in section 0: "Depth beats breadth on the
// fields that kill sites: capacity -> 24/7 -> fenced -> lit -> ingress/egress
// -> clearance -> rates." Rates & hours are one combined doc section
// ("Rates & hours (easiest — start here)"), so they're one checklist row.
//
// Tri-state rows read the schema fields directly: ANY recorded value
// (true/false/null) counts as done — null means a human checked and couldn't
// tell, which the tutorial's "done means" explicitly allows. This differs
// from the admin table's hard-filter badges, where null still renders
// '? unknown' (evaluateHardFilter) — deliberate: done-for-BDR ≠ pass-for-Waymo.
export const CHECKLIST_FIELDS: ChecklistFieldDef[] = [
  {
    key: 'capacity',
    label: 'Capacity (50+ stalls)',
    guidance:
      'Look for a number the operator actually states — an exact stall count in their site description or FAQ, or a city/port/county facility record. Reviews and photos are a weak signal only. Cite what you find in Notes; never estimate a number.',
    isEmpty: (l) => isEmpty(l.capacityText) && typeof l.stallsTotal !== 'number',
  },
  {
    key: 'open247',
    label: '24/7 access',
    guidance:
      "Only record this if a source states it outright — an hours page saying 24/7, or a listing's “open 24 hours” tag. A gateless/LPR gate suggests it but isn't proof by itself. Cite what you find in Notes.",
    isEmpty: (l) => l.access247 === undefined,
  },
  {
    key: 'fenced',
    label: 'Fenced',
    guidance:
      'Walk the perimeter in Street View — is a fence visible? Check operator photo galleries too. Note what the imagery shows and which tool/date you used (imagery you looked at is evidence).',
    isEmpty: (l) => l.fenced === undefined,
  },
  {
    key: 'lit',
    label: 'Lit',
    guidance:
      'Same approach as fenced — look for light poles or fixtures in Street View or photos, and note the source and date.',
    isEmpty: (l) => l.lit === undefined,
  },
  {
    key: 'ingressEgress',
    label: 'Ingress / egress',
    guidance:
      'Drive the frontage in Street View and check satellite view for curb cuts and one-way lane markings. Operator directions pages sometimes describe entrances too.',
    isEmpty: (l) => isEmpty(l.ingressEgress),
  },
  {
    key: 'clearance',
    label: 'Clearance',
    guidance:
      "Look for height signs — most garage pages post a clearance figure. Also check the SpotHero facility page's restrictions section.",
    isEmpty: (l) => isEmpty(l.clearanceText),
  },
  {
    key: 'ratesHours',
    label: 'Rates & hours',
    guidance:
      'Check the existing listing first, then verify against the operator’s own location page — it almost always states current rates and hours.',
    isEmpty: (l) => isEmpty(l.priceText) || isEmpty(l.hoursText),
  },
];

export interface BdrChecklistRow {
  key: string;
  label: string;
  guidance: string;
  ladder: string[];
  done: boolean;
}

/** All 7 checklist rows, in kill-order, each tagged done/not-done. */
export function bdrChecklistRows(location: SourcedParkingLocation): BdrChecklistRow[] {
  return CHECKLIST_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    guidance: f.guidance,
    ladder: GENERAL_LADDER,
    done: !f.isEmpty(location),
  }));
}

/** Only the rows still genuinely empty — what the "YOUR JOB HERE" list shows. */
export function deriveBdrChecklist(location: SourcedParkingLocation): BdrChecklistRow[] {
  return bdrChecklistRows(location).filter((r) => !r.done);
}

export function missingChecklistCount(location: SourcedParkingLocation): number {
  return deriveBdrChecklist(location).length;
}

// --- Queue ---------------------------------------------------------------

/** Flood-failed specifically (not any hard fail) — reuses evaluateHardFilter
 * directly rather than the more general hasHardFail, since the queue only
 * deprioritizes for the flood check, not e.g. a residential-adjacency fail. */
export function isFloodFailed(location: SourcedParkingLocation): boolean {
  return evaluateHardFilter(location, 'aboveFloodPlain').result === 'fail';
}

/** A record is a live BDR work item when it's still draft and hasn't been
 * folded into another record via a cross-source merge. */
export function isBdrVisible(location: SourcedParkingLocation): boolean {
  return location.status === 'draft' && !location.mergedInto;
}

/** Deterministic string hash (djb2) — used only to reorder records that are
 * otherwise tied, so the same seed always reproduces the same order
 * (testable) while a fresh seed per session/refresh (BdrQueueView) visibly
 * reshuffles the queue instead of looking frozen. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

function seededRank(seed: number, id: string): number {
  // XOR-combine two independently-mixed hashes rather than e.g. seeding
  // djb2's initial accumulator or concatenating seed+id — both of those are
  // affine in the trailing characters, so two ids sharing a prefix (like
  // "tie-a"/"tie-b") end up in the SAME relative order for every seed. XOR
  // of two unrelated multiplicative hashes has no such monotonicity.
  const seedMix = Math.imul(seed + 0x9e3779b9, 2654435761) | 0;
  return (hashId(id) ^ seedMix) | 0;
}

/**
 * BDR work queue: draft, non-merged records, most-missing-critical-fields
 * first, with flood-failed records sunk to the very end regardless of how
 * much else they're missing (visible, never hidden — same wide-net
 * principle as sortForReview in hardFilters.ts, just a different secondary
 * key: BDR effort remaining instead of createdAt-desc as primary).
 *
 * `seed`, when given, breaks ties among equally-urgent records (same flood
 * status, same missing-field count) by a reproducible pseudo-random order
 * instead of createdAt — so two BDRs' sessions (or one BDR's refresh) fan
 * out across those ties rather than racing to the identical top record.
 * Omitted (the default, and what every existing caller/test uses) keeps the
 * plain createdAt-desc tiebreak.
 */
/**
 * ODD-only by default (see BdrQueueView's `showOutsideOdd` toggle) — a lot
 * outside the Waymo service area isn't worth a BDR's time right now.
 * `includeOutsideOdd` reveals a confirmed-outside lot AND one with no
 * coords yet (isInWaymoOdd returns undefined) together; there's no
 * separate view for "only unknown".
 */
export function filterByOdd(
  locations: SourcedParkingLocation[],
  includeOutsideOdd: boolean,
): SourcedParkingLocation[] {
  return includeOutsideOdd ? locations : locations.filter((l) => isInWaymoOdd(l) === true);
}

export function buildBdrQueue(locations: SourcedParkingLocation[], seed?: number): SourcedParkingLocation[] {
  return locations.filter(isBdrVisible).sort((a, b) => {
    const aFlood = isFloodFailed(a) ? 1 : 0;
    const bFlood = isFloodFailed(b) ? 1 : 0;
    if (aFlood !== bFlood) return aFlood - bFlood;
    const missingDiff = missingChecklistCount(b) - missingChecklistCount(a);
    if (missingDiff !== 0) return missingDiff;
    if (seed !== undefined) return seededRank(seed, a.id) - seededRank(seed, b.id);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

// --- Card copy -------------------------------------------------------------

/** "Never worked" = no field on this record has ever been human-verified —
 * every fieldProvenance entry is still scraped/self-reported-only. */
export function neverWorked(location: SourcedParkingLocation): boolean {
  return !Object.values(location.fieldProvenance).some((v) => v === 'verified');
}

// Exported so the BDR wizard's one-tap-confirm prompt ("SpotHero says: ...")
// reuses this exact translation instead of re-deriving it — same rule as
// every other shared lookup in this module.
export const SOURCE_LABELS: Record<string, string> = {
  spothero: 'SpotHero',
  parkopedia: 'Parkopedia',
  manual: 'Manually added',
  laz: 'LAZ Parking',
  extension: 'Extension capture',
};

export function sourceLabel(location: SourcedParkingLocation): string {
  return SOURCE_LABELS[location.source] ?? location.source;
}

export function contextStripLabel(location: SourcedParkingLocation): string {
  const base = `${sourceLabel(location)} listing · ${neverWorked(location) ? 'never worked' : 'in progress'}`;
  return location.addedBy ? `${base} · added by ${location.addedBy}` : base;
}

export function mapsUrl(location: SourcedParkingLocation): string | null {
  if (typeof location.lat === 'number' && typeof location.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
  }
  if (location.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
  }
  return null;
}

// --- Part 3: admin-jargon -> plain-language translation -------------------

export const UNKNOWN_LABEL = 'Not found yet — check the sources ▾';

export const PROVENANCE_VALUES: FieldProvenanceValue[] = ['verified', 'self-reported', 'unknown'];

export const PROVENANCE_LABEL: Record<FieldProvenanceValue, string> = {
  verified: '✓ Confirmed from a source',
  'self-reported': 'Listed by parking company (not confirmed)',
  // Pipeline-set only (services/resources derivation) — not in
  // PROVENANCE_VALUES, so it can't be picked by hand in the BDR queue.
  derived: 'Auto-derived from enrichment data',
  unknown: UNKNOWN_LABEL,
};

export const STATUS_VALUES: SourcingStatus[] = ['draft', 'saved'];

export const STATUS_LABEL: Record<SourcingStatus, string> = {
  draft: 'Needs work',
  saved: 'Finished',
};

export const CONFLICT_LABEL = '⚠ Two sources disagree — check who’s right';

/** buildUpsertDoc (types.ts) logs conflicts as `conflict:<field>:<a>|<b>`
 * substrings joined into notes — this just checks for that marker rather
 * than re-deriving conflict detection. */
export function hasConflictNote(location: SourcedParkingLocation): boolean {
  return !!location.notes && location.notes.includes('conflict:');
}

/** null when the record doesn't fail the flood check; otherwise the
 * BDR-facing banner text, with the FEMA zone letter when known. */
export function floodBanner(location: SourcedParkingLocation): string | null {
  if (!isFloodFailed(location)) return null;
  const zone = location.geoContext?.floodZone;
  return zone
    ? `❌ Flood zone ${zone} — Waymo can't use it, skip details`
    : `❌ In a flood zone — Waymo can't use it, skip details`;
}
