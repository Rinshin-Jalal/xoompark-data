// Per-field source ladders for the Fill-track tutorial simulator — copied
// verbatim (numbering included) from docs/bdr-workflow.md §1, the v2 doc's
// actual field-by-field playbook. The old tutorial predated §1's per-field
// ladders entirely (it only had bdrView.ts's single GENERAL_LADDER, reused
// for every field) — this is new content, not a rewording of anything.
//
// Keyed by the same field keys bdrView.ts's CHECKLIST_FIELDS already uses,
// so the Fill track reuses that module's label/guidance/isEmpty per field
// rather than redefining them.
//
// FILL_TRACK_ORDER is deliberately NOT bdrView.ts's CHECKLIST_FIELDS order
// (its kill-order from §0: capacity -> 24/7 -> fenced -> lit ->
// ingress/egress -> clearance -> rates). The tutorial rework resequences
// rates/hours first (§1: "easiest — start here"), then the physical/harder
// fields in this order: capacity, fenced, lit, ingress/egress, clearance,
// 24/7.
export const FILL_TRACK_ORDER = [
  'ratesHours',
  'capacity',
  'fenced',
  'lit',
  'ingressEgress',
  'clearance',
  'open247',
] as const;

export type FillTrackFieldKey = (typeof FILL_TRACK_ORDER)[number];

// Doc heading in parens next to each key below, for traceability back to §1.
export const FIELD_SOURCE_LADDERS: Record<FillTrackFieldKey, string[]> = {
  // "Rates & hours (easiest — start here)"
  ratesHours: [
    'SpotHero/Parkopedia listing (already on the record — verify against operator site)',
    "Operator's own site — location page almost always lists rates",
    'Google Maps listing → "Parking" info / photos of rate boards',
    'Monthly parking pages (operators publish monthly rates separately)',
  ],
  // "Capacity (~50+ stalls needed)"
  capacity: [
    'Operator site ("400 spaces" in description/FAQ)',
    'Municipal records — city parking facility registries, airport/port authority pages',
    'Google Maps reviews — "huge lot", photos showing scale (weak signal — note it, don\'t guess numbers)',
    'County property appraiser — building/parking structure records',
    'If nothing: leave empty. Never estimate a number.',
  ],
  // "Fenced / Well lit" — doc covers both fields under one combined heading,
  // so fenced and lit share the identical ladder below.
  fenced: [
    'Google Street View — walk the perimeter virtually. Fence visible? Light poles? Light fixtures on garage ceilings visible through entrances?',
    'Operator site photo galleries — marketing shots show fencing/lighting constantly',
    'Google Maps user photos — recent ones show current state',
    'Record what the imagery SHOWS + which tool (notes: "fence visible SV 2024, north side"). Imagery is evidence — you verified from a source in front of you.',
  ],
  lit: [
    'Google Street View — walk the perimeter virtually. Fence visible? Light poles? Light fixtures on garage ceilings visible through entrances?',
    'Operator site photo galleries — marketing shots show fencing/lighting constantly',
    'Google Maps user photos — recent ones show current state',
    'Record what the imagery SHOWS + which tool (notes: "fence visible SV 2024, north side"). Imagery is evidence — you verified from a source in front of you.',
  ],
  // "Separate ingress/egress (one-way preferred)"
  ingressEgress: [
    'Street View — drive the frontage virtually. Count curb cuts/exits.',
    'Satellite/aerial view (Google Maps satellite) — ramp locations, one-way lane markings often visible',
    'Operator site maps/directions pages — usually describe entrance streets',
  ],
  // "Clearance (structured: 6'8\" min, 8' preferred)"
  clearance: [
    'Operator site — clearance posted on nearly every garage page ("Max height 6\'8\\"")',
    'SpotHero facility page restrictions section (already partially captured)',
    'Google Maps listing details/photos of the clearance sign',
    'Parkopedia height filters/data',
  ],
  // "24/7 access"
  open247: [
    'Operator site hours page',
    'Gate type implies it: "gateless/LPR entry" + monthly parkers → usually 24/7 (only record if STATED)',
    'SpotHero "opens 24 hours" tags',
  ],
};
