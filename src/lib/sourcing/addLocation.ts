// Pure validate/build logic for the admin "+ Add Location" manual-entry form.
// Firestore-free (same split as spotheroParse.ts vs spothero.ts) so it runs
// under plain `node --experimental-strip-types`, and so actions.ts's
// addSourcedLocation can re-validate server-side independent of whatever the
// client already checked — never trust the client.
import { slugifyCity } from '../citySlug.ts';
import type { FieldProvenanceValue, SourcedLocationInput } from './types.ts';

/** Raw shape the client form sends — everything a string, exactly what a
 * controlled `<input>`/`<textarea>` holds. Numbers are parsed/range-checked
 * server-side in validateAddLocationInput, not trusted from the client. */
export interface AddLocationFormInput {
  name: string;
  sourceUrl: string;
  address?: string;
  lat?: string;
  lng?: string;
  priceText?: string;
  hoursText?: string;
  capacityText?: string;
  clearanceText?: string;
  ingressEgress?: string;
  notes?: string;
  addedBy?: string;
  /** Set by the caller (the Hunt tracker), not typed by the BDR — see
   * SourcedLocationInput.locality for why this beats deriving it from the
   * address text. */
  locality?: string;
  /** Tri-state, not string-encoded like the rest of this form — these come
   * straight off TriStateControl (already boolean|null|undefined; null =
   * "checked, couldn't tell", a real recorded fact, same convention as the
   * BDR checklist), so there's no clean string round-trip worth inventing
   * just to keep this interface's fields uniformly stringly-typed. */
  access247?: boolean | null;
  fenced?: boolean | null;
  lit?: boolean | null;
}

export interface ValidatedAddLocation {
  name: string;
  sourceUrl: string;
  address?: string;
  lat?: number;
  lng?: number;
  priceText?: string;
  hoursText?: string;
  capacityText?: string;
  clearanceText?: string;
  ingressEgress?: string;
  notes?: string;
  addedBy?: string;
  locality?: string;
  access247?: boolean | null;
  fenced?: boolean | null;
  lit?: boolean | null;
}

export type AddLocationValidation =
  | { ok: true; value: ValidatedAddLocation }
  | { ok: false; fieldErrors: Record<string, string> };

const SOURCE_URL_ERROR = 'Source URL is required — where did you find this lot?';

/**
 * Real server-side validation, independent of the client's own checks.
 * Returns a typed fieldErrors map instead of throwing, so the client can
 * render errors inline next to the offending field.
 */
export function validateAddLocationInput(input: AddLocationFormInput): AddLocationValidation {
  const fieldErrors: Record<string, string> = {};

  const name = input.name?.trim() ?? '';
  if (!name) fieldErrors.name = 'Name is required.';

  const sourceUrl = input.sourceUrl?.trim() ?? '';
  if (!sourceUrl) {
    fieldErrors.sourceUrl = SOURCE_URL_ERROR;
  } else {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        fieldErrors.sourceUrl = SOURCE_URL_ERROR;
      }
    } catch {
      fieldErrors.sourceUrl = SOURCE_URL_ERROR;
    }
  }

  const address = input.address?.trim() || undefined;

  let lat: number | undefined;
  const latRaw = input.lat?.trim();
  if (latRaw) {
    const n = Number(latRaw);
    if (!Number.isFinite(n) || n < -90 || n > 90) {
      fieldErrors.lat = 'Latitude must be a number between -90 and 90.';
    } else {
      lat = n;
    }
  }

  let lng: number | undefined;
  const lngRaw = input.lng?.trim();
  if (lngRaw) {
    const n = Number(lngRaw);
    if (!Number.isFinite(n) || n < -180 || n > 180) {
      fieldErrors.lng = 'Longitude must be a number between -180 and 180.';
    } else {
      lng = n;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    value: {
      name,
      sourceUrl,
      address,
      lat,
      lng,
      priceText: input.priceText?.trim() || undefined,
      hoursText: input.hoursText?.trim() || undefined,
      capacityText: input.capacityText?.trim() || undefined,
      clearanceText: input.clearanceText?.trim() || undefined,
      ingressEgress: input.ingressEgress?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      addedBy: input.addedBy?.trim() || undefined,
      locality: input.locality,
      access247: input.access247,
      fenced: input.fenced,
      lit: input.lit,
    },
  };
}

/**
 * Build the SourcedLocationInput for a manual admin add. sourceListingId is
 * slugify(`${name}-${address}`) (or just name, if address is blank) truncated
 * to 80 chars — deterministic, so resubmitting the same name+address always
 * computes the same id and lands on the merge path rather than a duplicate
 * doc (see computeDedupeKey in types.ts: a non-empty sourceListingId always
 * wins over the addr: fallback path).
 *
 * rawInput is the raw form input itself (AddLocationFormInput) — there's no
 * "original scrape" to preserve here since a human typed this directly, so
 * the form values *are* the source-of-truth raw payload.
 */
export function buildAddLocationInput(
  value: ValidatedAddLocation,
  rawInput: AddLocationFormInput,
): SourcedLocationInput {
  const slugBase = value.address ? `${value.name}-${value.address}` : value.name;
  const sourceListingId = slugifyCity(slugBase).slice(0, 80);

  const fieldProvenance: Record<string, FieldProvenanceValue> = {};
  for (const [field, present] of [
    ['name', true],
    ['address', !!value.address],
    ['lat', value.lat !== undefined],
    ['lng', value.lng !== undefined],
    ['price_text', !!value.priceText],
    ['hours_text', !!value.hoursText],
    ['capacity_text', !!value.capacityText],
    ['clearance_text', !!value.clearanceText],
    ['ingressEgress', !!value.ingressEgress],
    // undefined = untouched; null = "checked, couldn't tell" is still a
    // recorded fact, same done-means convention as bdrView's checklist rows.
    ['access247', value.access247 !== undefined],
    ['fenced', value.fenced !== undefined],
    ['lit', value.lit !== undefined],
  ] as const) {
    if (present) fieldProvenance[field] = 'verified';
  }

  return {
    name: value.name,
    address: value.address,
    lat: value.lat,
    lng: value.lng,
    source: 'manual',
    sourceUrl: value.sourceUrl,
    sourceListingId,
    priceText: value.priceText,
    hoursText: value.hoursText,
    capacityText: value.capacityText,
    clearanceText: value.clearanceText,
    ingressEgress: value.ingressEgress,
    access247: value.access247,
    fenced: value.fenced,
    lit: value.lit,
    fieldProvenance,
    capturedBy: 'bdr-captured',
    addedBy: value.addedBy,
    locality: value.locality,
    rawInput,
    notes: value.notes,
  };
}
