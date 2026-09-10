// Pure step-sequencing + capture-state logic for the BDR one-field-at-a-time
// wizard (BdrQueueView.tsx's BdrCard). Reuses bdrView.ts's CHECKLIST_FIELDS
// for the field list/kill-order rather than re-deriving it — this module
// only adds the wizard's own "captured" notion, which is stricter than
// bdrChecklistRows' `done`: `done` is presence-only (a still-self-reported
// scraped value counts as done there), but the wizard needs to visit that
// field to get a human's one-tap confirm (or a fresh save) before it counts
// as captured — done means "has SOME value", captured means "a human signed
// off on this value" (fieldProvenance === 'verified' on the field(s) this
// step writes). Same Firestore/'server-only'-free split as the rest of this
// pipeline — only imports bdrView.ts and types.ts.
import { CHECKLIST_FIELDS } from './bdrView.ts';
import type { SourcedParkingLocation } from './types.ts';

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function verified(location: SourcedParkingLocation, field: string): boolean {
  return location.fieldProvenance[field] === 'verified';
}

/** The 7 checklist field keys, in bdrView.ts's kill-order (capacity -> 24/7
 * -> fenced -> lit -> ingress/egress -> clearance -> rates). */
export const WIZARD_FIELD_KEYS: string[] = CHECKLIST_FIELDS.map((f) => f.key);

export interface WizardFieldState {
  key: string;
  /** A human has verified this field's value (typed it fresh, or one-tap
   * confirmed a scraped value). Ignores session-only skip state — that's
   * layered on by the caller, since it isn't derivable from the record. */
  captured: boolean;
  /** Human-readable scraped value worth showing for one-tap confirm, or null
   * when there's nothing pre-filled worth confirming (empty, or already
   * captured). */
  scrapedValue: string | null;
}

function tristateState(
  location: SourcedParkingLocation,
  key: string,
  field: 'access247' | 'fenced' | 'lit',
): WizardFieldState {
  const captured = verified(location, field);
  const v = location[field];
  const scrapedValue = !captured && v !== undefined ? (v === null ? "Can't tell" : v ? 'Yes' : 'No') : null;
  return { key, captured, scrapedValue };
}

/** Derives the wizard's capture state + any confirmable scraped value for a
 * single checklist field, straight from the record (no session state). */
export function wizardFieldState(location: SourcedParkingLocation, key: string): WizardFieldState {
  switch (key) {
    case 'capacity': {
      const captured = verified(location, 'stallsTotal');
      const scrapedValue = !captured && typeof location.stallsTotal === 'number' ? String(location.stallsTotal) : null;
      return { key, captured, scrapedValue };
    }
    case 'open247':
      return tristateState(location, key, 'access247');
    case 'fenced':
      return tristateState(location, key, 'fenced');
    case 'lit':
      return tristateState(location, key, 'lit');
    case 'ingressEgress': {
      const captured = verified(location, 'ingressEgress');
      const scrapedValue = !captured && !isEmpty(location.ingressEgress) ? String(location.ingressEgress) : null;
      return { key, captured, scrapedValue };
    }
    case 'clearance': {
      const captured = verified(location, 'clearanceText');
      const scrapedValue = !captured && !isEmpty(location.clearanceText) ? location.clearanceText! : null;
      return { key, captured, scrapedValue };
    }
    case 'ratesHours': {
      const captured = verified(location, 'priceText') && verified(location, 'hoursText');
      const parts: string[] = [];
      if (!verified(location, 'priceText') && !isEmpty(location.priceText)) parts.push(location.priceText!);
      if (!verified(location, 'hoursText') && !isEmpty(location.hoursText)) parts.push(location.hoursText!);
      return { key, captured, scrapedValue: captured || parts.length === 0 ? null : parts.join(' · ') };
    }
    default:
      return { key, captured: false, scrapedValue: null };
  }
}

/**
 * A field's session-visible resolution state, unified in one place (used to
 * be three overlapping flags split across bdrWizard.ts and BdrQueueView.tsx:
 * captured/skipped here, `wrong` as a separate local Set in the component).
 * - 'unresolved': not yet touched this session, and not record-verified.
 * - 'captured': a human confirmed or freshly saved a value (record-verified,
 *   or a session override bridging the gap until the record refetches).
 * - 'skipped': a human chose to leave this field empty. Never overwrites an
 *   already-captured field (captured wins: revisiting a captured step and
 *   hitting Skip must not visually erase the earlier write).
 * - 'wrong': a human rejected the scraped confirm-value. Stays OPEN (same as
 *   'unresolved') — it still needs a manual save or an explicit skip.
 */
export type FieldStatus = 'unresolved' | 'captured' | 'skipped' | 'wrong';

export interface WizardStatus {
  key: string;
  status: FieldStatus;
}

/**
 * First index at/after fromIndex that's neither captured nor skipped,
 * wrapping around once so a step near the end of the array still finds an
 * earlier open field. -1 when every step is resolved (captured or skipped) —
 * that's the wizard's cue to show the summary screen.
 */
export function nextOpenStepIndex(statuses: WizardStatus[], fromIndex: number): number {
  const n = statuses.length;
  if (n === 0) return -1;
  for (let i = 0; i < n; i++) {
    const idx = (fromIndex + i) % n;
    const status = statuses[idx].status;
    if (status !== 'captured' && status !== 'skipped') return idx;
  }
  return -1;
}

export interface WizardSummary {
  captured: number;
  skipped: number;
  /** Neither captured nor skipped (i.e. 'unresolved' or 'wrong') — should
   * always be 0 by the time the summary screen shows (every field is
   * resolved one way or the other), but computed honestly rather than
   * hardcoded in case a step was somehow left unresolved. */
  unknown: number;
}

export function summarizeWizard(statuses: WizardStatus[]): WizardSummary {
  let captured = 0;
  let skipped = 0;
  let unknown = 0;
  for (const s of statuses) {
    if (s.status === 'captured') captured++;
    else if (s.status === 'skipped') skipped++;
    else unknown++;
  }
  return { captured, skipped, unknown };
}
