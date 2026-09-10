// Pure gate-evidence extraction from SpotHero facility-detail payloads —
// deliberately network- and Firestore-free (same split as every other
// sourcing module) so it runs under plain `node --experimental-strip-types`.
//
// Recon (2026-09-04, live facility 103525): redemptionInstructions[] carries
// {text} sentences like "Our cameras will recognize your license plate" /
// "Just drive in" / "Make sure your license plate matches the plate on your
// Parking Pass" — the gate behaviour no listing field ever states. amenities
// carry attendant/valet/touchless/self-park. restrictions sometimes add
// plate-validation lines.
//
// Rule (enrichment-plan.md #2): extraction produces CLAIMS, never writes
// gateType directly. Only camera/plate-recognition text is explicit enough
// to normalize — derivedGateType is 'lpr' or nothing.
import type { SourcedParkingLocation } from './types.ts';

export type GateEvidence = NonNullable<SourcedParkingLocation['gateEvidence']>;

/** The facility-detail fields gate claims come from (subset of
 * SpotHeroFacilityDetail in spotheroDetailParse.ts — kept structural so
 * this module doesn't import the network-adjacent parser). */
export interface GateEvidenceSource {
  redemptionInstructions?: Array<{ text?: string }> | null;
  amenities?: Array<{ type?: string }> | null;
  restrictions?: string[] | null;
}

/** Amenity types that say something about how you get in/out. */
const GATE_AMENITIES = new Set(['attendant', 'valet', 'touchless', 'self-park']);

/** Camera/plate recognition — the only vocabulary explicit enough to derive. */
const LPR_EXPLICIT = /camera|recogniz|license plate|plate on your/i;

/**
 * Verbatim gate-behaviour claims from a facility payload. Redemption
 * instruction sentences come through verbatim (the audit trail); amenities
 * become short labelled claims; plate-validation restriction lines are kept.
 */
export function extractGateClaims(source: GateEvidenceSource): string[] {
  const claims: string[] = [];
  for (const r of source.redemptionInstructions ?? []) {
    if (r?.text?.trim()) claims.push(r.text.trim());
  }
  for (const a of source.amenities ?? []) {
    if (a?.type && GATE_AMENITIES.has(a.type)) claims.push(`amenity: ${a.type}`);
  }
  for (const r of source.restrictions ?? []) {
    if (LPR_EXPLICIT.test(r)) claims.push(r.trim());
  }
  return claims;
}

/**
 * Derive gateType from claims — 'lpr' only, and only when a sentence
 * explicitly describes plate recognition (camera or plate matching).
 * "Just drive in" is suggestive of gateless but NOT explicit (an open gate
 * arm reads the same) — stays a claim, per the plan's rule.
 */
export function deriveGateType(claims: string[]): 'lpr' | undefined {
  const hasPlateRecognition = claims.some((c) => LPR_EXPLICIT.test(c));
  return hasPlateRecognition ? 'lpr' : undefined;
}

/** Full pure resolution: payload -> stored gateEvidence block. */
export function toGateEvidence(source: GateEvidenceSource, sourceUrl: string, now: string): GateEvidence | null {
  const claims = extractGateClaims(source);
  if (claims.length === 0) return null;
  const ev: GateEvidence = { claims, sourceUrl, checkedAt: now };
  const derived = deriveGateType(claims);
  if (derived) ev.derivedGateType = derived;
  return ev;
}
