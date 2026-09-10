// Pure validation for the fleet feedback body. Deliberately Firestore- and
// 'server-only'-free so the trust-boundary rules are testable with plain
// `node --experimental-strip-types`, same split as sites.ts.
export interface FeedbackInput {
  decision: 'selected' | 'rejected';
  reasons: string[];
  notes: string | null;
}

export const MAX_REASONS = 50;
export const MAX_REASON_LENGTH = 500;
export const MAX_NOTES_LENGTH = 5000;

/**
 * Validate an untrusted feedback body. Accepts exactly:
 *   { decision: 'selected' | 'rejected', reasons?: string[], notes?: string }
 * Everything else — arrays, null, primitives, extra junk — is rejected.
 * The returned object is freshly constructed from validated pieces only,
 * never a pass-through of the input, so nothing unvalidated can leak into
 * the Firestore write.
 */
export function parseFeedbackBody(body: unknown): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const { decision, reasons, notes } = body as { decision?: unknown; reasons?: unknown; notes?: unknown };

  if (decision !== 'selected' && decision !== 'rejected') {
    return { ok: false, error: "decision must be 'selected' or 'rejected'" };
  }
  if (reasons !== undefined && (!Array.isArray(reasons) || reasons.some((r) => typeof r !== 'string'))) {
    return { ok: false, error: 'reasons must be an array of strings' };
  }
  if (notes !== undefined && typeof notes !== 'string') {
    return { ok: false, error: 'notes must be a string' };
  }

  const validatedReasons = (reasons as string[] | undefined) ?? [];
  if (validatedReasons.length > MAX_REASONS || validatedReasons.some((r) => r.length > MAX_REASON_LENGTH)) {
    return { ok: false, error: `reasons: max ${MAX_REASONS} items, ${MAX_REASON_LENGTH} chars each` };
  }
  const validatedNotes = typeof notes === 'string' ? notes : null;
  if (validatedNotes !== null && validatedNotes.length > MAX_NOTES_LENGTH) {
    return { ok: false, error: `notes must be at most ${MAX_NOTES_LENGTH} characters` };
  }

  return { ok: true, value: { decision, reasons: validatedReasons, notes: validatedNotes } };
}

/**
 * Deterministic feedback doc id per fleet key + site: re-posting a decision
 * updates the existing doc (latest wins) instead of stacking duplicates
 * into the ML training data. '/' is illegal in Firestore doc ids; siteIds
 * from computeDedupeKey can contain ':' (legal) but '/' is sanitized
 * defensively. Firestore doc ids cap at 1500 bytes — enforced here so a
 * hostile/absurd site id can't make the write fail.
 */
export function feedbackDocId(keyId: string, siteId: string): string {
  const id = `${keyId}__${siteId}`.replace(/\//g, '_');
  return id.length > 1200 ? id.slice(0, 1200) : id;
}
